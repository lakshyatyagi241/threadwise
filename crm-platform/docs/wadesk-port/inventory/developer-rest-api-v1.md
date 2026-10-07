---
domain: developer-rest-api-v1
code: API
title: Developer REST API v1, API keys and developer docs
wadesk_version: '1.7.0'
sources_read: 140
---

# Developer REST API v1, API keys and developer docs

## Overview

WaDesk ships a public, versioned REST API at `/api/v1` so a customer's own apps, CRM or automation can drive one workspace. A workspace owner
or admin opens **Developers** (`/developers`, menu entry "REST API" in the Developer group), creates **one API key** and copies it once; only a
sha256 hash and a 12-character prefix are kept. The key is a bearer token (`Authorization: Bearer wsk_...` or `X-Api-Key`), belongs to one
workspace and acts as the member who minted it. Each key is throttled per minute from the plan, else a platform default of 600. Answers use a
`{ data, meta }` envelope and an `{ error: { code, message } }` error envelope. A public docs page (`/developers/docs`) is built from a generated
OpenAPI document (`/docs/api.json`).

The API is a thin layer over the same code the dashboard uses: 59 routes in 12 resource files for messages, media, conversations, contacts and
groups, deals, templates, auto-replies, broadcasts, campaigns, scheduled messages, flows, devices, webhooks and the account (`/me`, `/usage`).
Outbound **webhooks** (event subscriptions) are registered through the API and delivered by a shared pipeline owned by the integrations domain.

Who uses it: workspace admins (key console), developers (the API and the docs page), platform admins (rate-limit settings). Plan tiers change only
the rate limit (and Deals answers 403 without the sales pipeline); there is no "API access" plan feature in WaDesk although the docs call API access
a paid feature.

Connections: `plans-subscriptions-trials` (limits, `api_rate_limit_per_minute`, `access_sales_pipeline`), `auth-registration-security` (global rate-limit
setting, SecureUpload), `contacts-attributes-tags` (contacts, groups), `deals-pipelines`, `message-templates`, `auto-reply-keywords`, `broadcasts`,
`campaigns`, `scheduled-queue-warmer`, `flow-runtime-engine` (enrollment), `whatsapp-devices-baileys` and `whatsapp-cloud-api-waba` (senders),
`team-inbox-conversations` and `chat-conversations` (messages, conversations), `wallet-message-billing` (credits, send billing),
`integrations-hubspot-slack-trello-google-webhooks` (webhook UI and delivery), `platform-infrastructure` (spec route, throttle).

## Feature index

| Id         | Feature                                                                             | Status      | Priority | Effort | Depends on                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| WD-API-001 | Create (mint) an API key                                                            | implemented | P0       | M      | WD-PLAN-006, WD-RBAC-001                                                                                                       |
| WD-API-002 | List the workspace's API keys                                                       | implemented | P0       | S      | WD-API-001                                                                                                                     |
| WD-API-003 | Revoke an API key                                                                   | implemented | P0       | S      | WD-API-001                                                                                                                     |
| WD-API-004 | One active key per workspace                                                        | implemented | P0       | S      | WD-API-001                                                                                                                     |
| WD-API-005 | API-key authentication (Bearer or X-Api-Key)                                        | implemented | P0       | M      | WD-API-001                                                                                                                     |
| WD-API-006 | Per-key rate limit (plan, platform default, unlimited)                              | implemented | P0       | M      | WD-API-005, WD-PLAN-022                                                                                                        |
| WD-API-007 | Response and error envelopes, validation rendering                                  | implemented | P0       | M      | WD-API-005                                                                                                                     |
| WD-API-008 | Key scopes                                                                          | dead-code   | P2       | S      | WD-API-005                                                                                                                     |
| WD-API-009 | Plan and lifecycle gates on the public API                                          | partial     | P1       | S      | WD-API-005, WD-PLAN-001                                                                                                        |
| WD-API-010 | Developers entry in the menu and who may open the console                           | implemented | P1       | S      | WD-API-002                                                                                                                     |
| WD-API-011 | API rate-limit settings (platform default, per plan)                                | implemented | P1       | S      | WD-API-006                                                                                                                     |
| WD-API-020 | GET /me - workspace, plan, limits, features                                         | implemented | P0       | S      | WD-API-005, WD-PLAN-001                                                                                                        |
| WD-API-021 | GET /usage - message cycle, plan validity, meters, credits                          | implemented | P0       | M      | WD-API-005, WD-PLAN-006, WD-WALLET-001                                                                                         |
| WD-API-022 | GET /contacts - list with search                                                    | implemented | P0       | M      | WD-API-005, WD-CON-001                                                                                                         |
| WD-API-023 | GET /contacts/{id}                                                                  | implemented | P0       | S      | WD-API-022                                                                                                                     |
| WD-API-024 | POST /contacts                                                                      | implemented | P0       | M      | WD-API-022, WD-CON-001                                                                                                         |
| WD-API-025 | PUT /contacts/{id}                                                                  | implemented | P0       | M      | WD-API-023                                                                                                                     |
| WD-API-026 | DELETE /contacts/{id}                                                               | implemented | P0       | S      | WD-API-023                                                                                                                     |
| WD-API-027 | GET /contact-groups                                                                 | implemented | P0       | S      | WD-API-005, WD-CON-001                                                                                                         |
| WD-API-028 | POST /contact-groups                                                                | implemented | P0       | S      | WD-API-027                                                                                                                     |
| WD-API-029 | DELETE /contact-groups/{id}                                                         | implemented | P0       | S      | WD-API-027                                                                                                                     |
| WD-API-030 | GET /templates: list templates                                                      | implemented | P1       | S      | WD-API-005, WD-API-006, WD-API-007, WD-TPL-004                                                                                 |
| WD-API-031 | GET /templates/categories: static category list                                     | implemented | P2       | S      | WD-API-005, WD-API-007                                                                                                         |
| WD-API-032 | POST /templates: create a template (local only, no Meta submission)                 | partial     | P1       | M      | WD-API-005, WD-API-007, WD-TPL-007, WD-TPL-008                                                                                 |
| WD-API-033 | GET /templates/{id}: template detail                                                | implemented | P1       | S      | WD-API-005, WD-API-007, WD-API-030                                                                                             |
| WD-API-034 | PUT /templates/{id}: update a template                                              | partial     | P1       | M      | WD-API-032, WD-TPL-019                                                                                                         |
| WD-API-035 | DELETE /templates/{id}: delete a template                                           | implemented | P1       | S      | WD-API-033, WD-TPL-020, WD-TPL-050                                                                                             |
| WD-API-036 | POST /templates/{id}/send: send a template to one number                            | implemented | P0       | L      | WD-TPL-033, WD-TPL-034, WD-CON-055, WD-TIB1-044                                                                                |
| WD-API-037 | Template send: inline header media upload and secure-upload guard                   | implemented | P1       | S      | WD-API-036, WD-TPL-035                                                                                                         |
| WD-API-038 | GET /auto-replies: list rules                                                       | implemented | P1       | S      | WD-API-005, WD-API-007, WD-AR-001                                                                                              |
| WD-API-039 | POST /auto-replies: create a keyword rule                                           | partial     | P1       | M      | WD-API-043, WD-AR-010, WD-AR-023, WD-AR-024                                                                                    |
| WD-API-040 | GET /auto-replies/{id}: rule detail                                                 | implemented | P1       | S      | WD-API-038                                                                                                                     |
| WD-API-041 | PUT /auto-replies/{id}: update a rule                                               | partial     | P1       | M      | WD-API-039, WD-AR-012                                                                                                          |
| WD-API-042 | DELETE /auto-replies/{id}: delete a rule                                            | implemented | P1       | S      | WD-API-040, WD-AR-006, WD-AR-042                                                                                               |
| WD-API-043 | Auto-reply sender (device_id) resolution: helper missing in shipped code            | dead-code   | P1       | S      | WD-AR-011                                                                                                                      |
| WD-API-044 | GET /flows: list flows                                                              | implemented | P1       | S      | WD-API-005, WD-API-007, WD-FLR-001                                                                                             |
| WD-API-045 | GET /flows/{id}: flow detail                                                        | implemented | P1       | S      | WD-API-044                                                                                                                     |
| WD-API-046 | POST /flows/{id}/enroll: enroll a contact by id or phone                            | implemented | P0       | M      | WD-FLR-009, WD-FLR-011, WD-API-045                                                                                             |
| WD-API-047 | GET /flows/{id}/subscribers: subscriber list and counts                             | implemented | P1       | S      | WD-FLR-009, WD-FLR-051, WD-FLR-052                                                                                             |
| WD-API-048 | GET /deals: paginated list with filters                                             | implemented | P1       | S      | WD-API-053, WD-DEAL-030                                                                                                        |
| WD-API-049 | POST /deals: create a deal                                                          | implemented | P1       | M      | WD-API-053, WD-DEAL-002, WD-DEAL-032                                                                                           |
| WD-API-050 | GET /deals/{id}: deal detail                                                        | implemented | P1       | S      | WD-API-053, WD-DEAL-031                                                                                                        |
| WD-API-051 | PUT /deals/{id}: partial update including stage move                                | implemented | P1       | M      | WD-API-054, WD-DEAL-033                                                                                                        |
| WD-API-052 | DELETE /deals/{id}: delete a deal                                                   | implemented | P1       | S      | WD-API-053, WD-DEAL-034                                                                                                        |
| WD-API-053 | Deals API plan gate (access_sales_pipeline) and admin bypass                        | implemented | P0       | S      | WD-DEAL-001, WD-DEAL-035, WD-PLAN-017                                                                                          |
| WD-API-054 | Deal stage change via API: status sync, timeline row, flow trigger, notification    | implemented | P1       | M      | WD-DEAL-008, WD-DEAL-018, WD-DEAL-027, WD-FLR-011                                                                              |
| WD-API-080 | Create a broadcast (POST broadcasts)                                                | implemented | P0       | M      | WD-API-005, WD-API-006, WD-API-007, WD-BCAST-009, WD-BCAST-010, WD-BCAST-015, WD-BCAST-016                                     |
| WD-API-081 | List broadcasts (GET broadcasts)                                                    | implemented | P1       | S      | WD-API-005, WD-API-007, WD-BCAST-001                                                                                           |
| WD-API-082 | Read one broadcast with status counts (GET broadcasts/{id})                         | implemented | P1       | S      | WD-API-005, WD-API-007, WD-BCAST-027                                                                                           |
| WD-API-083 | List broadcast recipients (GET broadcasts/{id}/recipients)                          | implemented | P1       | S      | WD-API-082, WD-BCAST-032, WD-BCAST-036                                                                                         |
| WD-API-084 | Stop a broadcast (POST broadcasts/{id}/stop)                                        | implemented | P1       | S      | WD-API-082, WD-BCAST-040, WD-BCAST-029                                                                                         |
| WD-API-085 | Campaign statistics rollup (GET campaigns/statistics)                               | implemented | P1       | S      | WD-API-005, WD-API-007, WD-CAMP-001                                                                                            |
| WD-API-086 | List campaigns (GET campaigns)                                                      | implemented | P1       | S      | WD-API-005, WD-API-007, WD-CAMP-001                                                                                            |
| WD-API-087 | Create and dispatch a campaign (POST campaigns)                                     | implemented | P0       | L      | WD-API-005, WD-API-006, WD-API-007, WD-API-095, WD-CAMP-003, WD-CAMP-005, WD-CAMP-008, WD-PLAN-017, WD-PLAN-018                |
| WD-API-088 | Read one campaign with live counts (GET campaigns/{id})                             | implemented | P1       | S      | WD-API-086, WD-CAMP-019                                                                                                        |
| WD-API-089 | Stop a campaign (POST campaigns/{id}/stop)                                          | implemented | P1       | S      | WD-API-088, WD-CAMP-016                                                                                                        |
| WD-API-090 | Delete a campaign (DELETE campaigns/{id})                                           | implemented | P1       | S      | WD-API-088, WD-CAMP-018                                                                                                        |
| WD-API-091 | Schedule a one-off message (POST scheduled)                                         | implemented | P1       | M      | WD-API-005, WD-API-006, WD-API-007, WD-SCHED-003, WD-SCHED-029                                                                 |
| WD-API-092 | List scheduled messages (GET scheduled)                                             | implemented | P1       | S      | WD-API-005, WD-API-007, WD-SCHED-001                                                                                           |
| WD-API-093 | Read one scheduled message (GET scheduled/{id})                                     | implemented | P1       | S      | WD-API-092, WD-SCHED-012                                                                                                       |
| WD-API-094 | Cancel a scheduled message (DELETE scheduled/{id})                                  | implemented | P1       | S      | WD-API-093, WD-SCHED-014                                                                                                       |
| WD-API-095 | Campaign API recipient materialisation and sender-id translation                    | implemented | P1       | S      | WD-API-087, WD-CON-013, WD-CON-055, WD-WADEV-032                                                                               |
| WD-API-110 | Send one message (POST /messages): text, media, location                            | implemented | P0       | L      | WD-API-005, WD-API-006, WD-API-007, WD-API-118, WD-API-119, WD-TIB1-042, WD-WADEV-032, WD-WALLET-009, WD-SCHED-009, WD-CON-048 |
| WD-API-111 | Message history list (GET /messages)                                                | implemented | P1       | S      | WD-API-005, WD-API-007, WD-API-120                                                                                             |
| WD-API-112 | Message status lookup (GET /messages/{id})                                          | implemented | P0       | S      | WD-API-005, WD-API-007, WD-API-120                                                                                             |
| WD-API-113 | Media upload for reuse (POST /media)                                                | implemented | P1       | M      | WD-API-005, WD-API-007, WD-SET-039                                                                                             |
| WD-API-114 | Conversation list (GET /conversations)                                              | implemented | P1       | S      | WD-API-005, WD-API-007, WD-TIB1-042, WD-TIB1-043                                                                               |
| WD-API-115 | Messages of one conversation (GET /conversations/{id}/messages)                     | implemented | P1       | S      | WD-API-005, WD-API-007, WD-API-120, WD-API-114                                                                                 |
| WD-API-116 | Device and channel list (GET /devices)                                              | implemented | P1       | S      | WD-API-005, WD-API-007, WD-WADEV-032, WD-WABA-022                                                                              |
| WD-API-117 | Single device (GET /devices/{id})                                                   | implemented | P2       | S      | WD-API-005, WD-API-007, WD-API-116                                                                                             |
| WD-API-118 | Single-send sender resolution across devices and provider configs                   | implemented | P0       | M      | WD-WADEV-032, WD-WADEV-030, WD-WABA-022                                                                                        |
| WD-API-119 | Single-send media intake: attached file or downloaded URL                           | implemented | P1       | M      | WD-API-113, WD-SET-039, WD-NODE-027                                                                                            |
| WD-API-120 | Public message shape and status vocabulary                                          | implemented | P0       | S      | WD-CHAT-013, WD-CHAT-014, WD-WABA-037, WD-NODE-038                                                                             |
| WD-API-140 | List webhooks (GET /webhooks)                                                       | implemented | P1       | S      | WD-API-005, WD-API-007, WD-API-143                                                                                             |
| WD-API-141 | Register a webhook (POST /webhooks)                                                 | implemented | P1       | M      | WD-API-005, WD-API-007, WD-API-143                                                                                             |
| WD-API-142 | Delete a webhook (DELETE /webhooks/{id})                                            | implemented | P1       | S      | WD-API-005, WD-API-007                                                                                                         |
| WD-API-143 | Event catalogue and subscription matching                                           | implemented | P0       | S      | none                                                                                                                           |
| WD-API-144 | Event emit and dispatch pipeline (recipient selection, deferral, failure isolation) | implemented | P0       | M      | WD-API-143                                                                                                                     |
| WD-API-145 | Event producers per domain (which event fires from where, with which data)          | implemented | P0       | L      | WD-API-144                                                                                                                     |
| WD-API-146 | Delivery envelope, HMAC signing and brand-prefixed headers                          | implemented | P0       | S      | WD-API-144                                                                                                                     |
| WD-API-147 | Delivery attempts: timeout, inline retries, health counters                         | implemented | P0       | M      | WD-API-146                                                                                                                     |
| WD-API-148 | Delivery log (webhook_deliveries)                                                   | implemented | P1       | S      | WD-API-147                                                                                                                     |
| WD-API-149 | Public developer docs page (/developers/docs, redirects /docs and /docs/api)        | implemented | P1       | M      | WD-API-150, WD-API-143                                                                                                         |
| WD-API-150 | OpenAPI specification generation (/docs/api.json) and white-labelling               | implemented | P1       | M      | none                                                                                                                           |
| WD-API-151 | Developers console page (/developers) UX                                            | implemented | P1       | M      | WD-API-001, WD-API-002, WD-API-003, WD-API-149                                                                                 |

## Features

### WD-API-001 — Create (mint) an API key

- **Status:** implemented
- **Priority:** P0 (the whole REST API is unreachable without a key)
- **Effort:** M (<=1 week; migration, service, console endpoints, contract, web form, tests)
- **Depends on:** WD-PLAN-006 (limit `api_keys`), WD-RBAC-001
- **Summary:** A workspace member opens the Developers console, gives the key a name and creates it. The raw key is shown exactly once, in a banner on the page that follows; only a hash is stored. The key belongs to one workspace and acts as the member who created it.
- **Actors & access:** any signed-in member of the workspace. WaDesk puts no role check on the console routes (only login); the menu entry is shown to owners and admins only (see WD-API-010). No plan or limit check except the one-active-key rule (WD-API-004). Workspace scope only.
- **UX & screens:** `/developers` (blade `resources/views/user/developers/index.blade.php`). When the workspace has no active key the main column shows a "Create your key" card with one required text field "Key name" (max 120 characters, placeholder "e.g. Production backend") and a "Create key" button. Validation error shows under the field. After success the page redirects to itself and shows a green banner "Your new API key" with the raw key in a monospace box and a "Copy" button, the line "Copy this now and store it safely ... it will never be shown again", plus a success status "API key created. Copy it now - it won't be shown again." The raw key is carried in a one-time flash; reloading the page makes it unrecoverable. If an active key already exists the card is replaced by the active-key card (WD-API-002) and a create attempt flashes the error of WD-API-004.
- **Endpoints:**

| Endpoint             | Route name                 | Controller@action            | Middleware | Request fields                 | Response                                                                                        |
| -------------------- | -------------------------- | ---------------------------- | ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| POST developers/keys | user.developers.keys.store | DeveloperApiController@store | web, auth  | `name` required string max 120 | redirect to `/developers` with flash `api_key_once` and `status`, or flash `error` (WD-API-004) |

- **Data:** table `api_keys` (WaDesk): `workspace_id`, `user_id` (the owner it acts as, the minting user), `name`, `key_hash` (sha256 hex of the raw key, unique), `prefix` (first 12 characters of the raw key, shown in the list), `scopes` (json, null = full access), `last_used_at`, `expires_at`, `revoked_at`, `created_by`, timestamps. The raw key is `wsk_` followed by 40 random characters. `scopes` is always null and `expires_at` is never set from the UI.
- **Rules & edge cases:**
  1. `name` is required and at most 120 characters; a blank or whitespace-only name fails validation and no key is created.
  2. The raw key is generated server side, hashed with sha256, and never stored or logged; there is no way to show it again, only revoke and mint a new one.
  3. The key's workspace is the minting member's current workspace; the key acts as that member (`user_id`), so a record created through the API is attributed to them.
  4. No audit entry, notification or email is written by WaDesk. QUIRK: a key mint is invisible in the activity log. (Ours writes an audit row, see Port notes.)
  5. Double submit: the second request hits WD-API-004 and is refused, so only one key exists.
  6. No expiry and no scope can be chosen.
- **Async & events:** none in WaDesk. Port: audit row `api_key.created` and outbox event `api.key_created` in the same transaction.
- **External systems:** none.
- **Settings:** plan limit `api_keys` (ours: 1 / 5 / 20 on the seeded plans, WD-PLAN-006) caps active keys; see WD-API-004.
- **Acceptance criteria:**
  - Given a workspace with no active key, when a member posts a name of 1-120 characters, then a key is created, the page shows the raw key once (it starts with `wsk_` and is 44 characters) and only the 12-character prefix and a hash are stored.
  - Given a key was just created, when the page is reloaded, then the raw key is gone and only the prefix is shown.
  - Given a blank name or one longer than 120 characters, when the form is posted, then nothing is created and the field shows a validation error.
  - Given two requests created at the same moment, when both are processed, then exactly one key exists and the other is refused with the WD-API-004 message.
  - Given a key minted in workspace A, when a member of workspace B lists keys, then it is not visible.
  - Given a minted key, when it is used on the API (WD-API-005), then records it creates are attributed to the member who minted it.
- **Source refs:** `app/Http/Controllers/DeveloperApiController.php`, `app/Models/ApiKey.php` (`mint`), `database/migrations/2026_06_13_000100_create_api_keys_table.php`, `resources/views/user/developers/index.blade.php`, `routes/web.php` (developers routes).
- **Port notes:** table `api_keys` already exists (`packages/db/src/schema/partner.ts`, migrations 0005 and `20261001102400_api_wadesk_schema.sql` adds `revoked_at`, `user_id`). A new `api` migration adds `kind` (`signed` partner key vs `bearer` WaDesk-style key) and makes `signing_secret_enc` nullable for bearer keys. Raw key format kept (`wsk_` + 40 random characters) so existing client code that pattern-matches keeps working; `key_prefix` = first 12 characters, unique; hash is sha256 with a constant-time compare (a 40-character random secret needs no slow hash, and argon2 per request would be a CPU lever on a polled API). Console is staff-only (`@ActorKinds('user')`), permission `api.keys.create`, `@Idempotent`, audit and outbox in the same transaction. Web: `apps/web/src/features/developer-rest-api-v1`, route `/developers`, settings tile `rest-api` already planned in `features/_registry/settings-planned.ts`.

### WD-API-002 — List the workspace's API keys

- **Status:** implemented
- **Priority:** P0
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-001
- **Summary:** The Developers console shows the workspace's key: name, prefix, created date, last-used time and an Active badge, or the create form when none is active.
- **Actors & access:** same as WD-API-001. WaDesk loads every key of the workspace including revoked ones, newest first, but the page only draws the first non-revoked key.
- **UX & screens:** left rail with a platform card ("Developer API", "REST · /api/v1", a "Key active" or "No key yet" pill), a Base URL card with copy button (APP_URL + `/api/v1`) and an Auth header card (`Authorization: Bearer <key>`), a help card linking to the docs; main column with the title "Developer API keys", Back and Open docs buttons, the one-time banner (WD-API-001), the active-key card (name or "Untitled key", `prefix…`, "Created Mon D, YYYY", "Last used <relative time>" or "never", Active pill, Revoke button, footer "Only one key is allowed per workspace. Revoke this one to issue a new key.") or the create card, and a Quickstart card with a curl example for `POST /messages`. Empty state is the create card. A flashed error shows as a red notice above the key card.
- **Endpoints:**

| Endpoint       | Route name      | Controller@action            | Middleware | Request fields | Response                           |
| -------------- | --------------- | ---------------------------- | ---------- | -------------- | ---------------------------------- |
| GET developers | user.developers | DeveloperApiController@index | web, auth  | none           | HTML page with the keys collection |

- **Data:** reads `api_keys` where `workspace_id` = current workspace, ordered by id descending.
- **Rules & edge cases:**
  1. Only the first non-revoked key is drawn. An expired but unrevoked key still counts as active. QUIRK.
  2. Revoked keys are loaded but never listed; the console cannot show history.
  3. "Last used" is a relative time of `last_used_at`, written on every API call (WD-API-005).
  4. The base URL uses the configured APP_URL, not the request host.
  5. The quickstart example sends `{"to":"919812345678","type":"text","text":"Hello from <brand>"}` to `/messages` and uses the brand name from settings.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** brand name (`brand_name()`), APP_URL.
- **Acceptance criteria:**
  - Given a workspace with one active key, when the console opens, then the key's name, prefix with an ellipsis, creation date and "never" or the last-used time are shown with the Active pill and a Revoke button.
  - Given a workspace with no active key, when the console opens, then the create form shows and the rail pill reads "No key yet".
  - Given a revoked key and no other key, when the console opens, then the create form shows.
  - Given the key is used on the API, when the console reloads, then "Last used" is no longer "never".
  - Given another workspace's key, when the console opens, then it is not listed.
- **Source refs:** `app/Http/Controllers/DeveloperApiController.php` (`index`), `resources/views/user/developers/index.blade.php`.
- **Port notes:** staff endpoint `GET /v2/developer/keys` (cursor list, uuid ids, `permission api.keys.read`) returning name, prefix, status, createdAt, lastUsedAt, expiresAt, revokedAt, createdBy; the page draws the active key from it. Never return the hash or the signing secret. Page design is WD-API-151.

### WD-API-003 — Revoke an API key

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-001
- **Summary:** The member revokes the workspace's key after a confirmation. Every app using it stops working at once and a new key can be created.
- **Actors & access:** same as WD-API-001. A key of another workspace answers 404.
- **UX & screens:** "Revoke" button on the active-key card opens a confirm dialog titled "Revoke this key?" with the message "Any app or integration using this key will immediately stop working. This cannot be undone. You can create a new key afterwards." and accept button "Revoke". Success status: "API key revoked. Any app using it will stop working immediately."
- **Endpoints:**

| Endpoint                    | Route name                   | Controller@action              | Middleware | Request fields | Response                              |
| --------------------------- | ---------------------------- | ------------------------------ | ---------- | -------------- | ------------------------------------- |
| DELETE developers/keys/{id} | user.developers.keys.destroy | DeveloperApiController@destroy | web, auth  | id numeric     | redirect to `/developers` with status |

- **Data:** sets `api_keys.revoked_at` = now. The row stays (soft revoke); no hard delete exists anywhere.
- **Rules & edge cases:**
  1. Idempotent: revoking a revoked key keeps its original `revoked_at` and answers the same success.
  2. Takes effect on the next API call: authentication refuses a key with `revoked_at` set (WD-API-005).
  3. A non-numeric id does not match the route (404).
  4. Nothing else is touched (no notification, no audit, no webhook). QUIRK.
- **Async & events:** none in WaDesk. Port: audit row `api_key.revoked`, outbox `api.key_revoked`; the auth cache entry for the key is dropped.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active key, when it is revoked, then the next API call with it answers 401 `invalid_api_key`.
  - Given a revoked key, when the console opens, then the create form shows (a new key may be minted).
  - Given a key of workspace A, when a member of workspace B revokes its id, then 404 and the key still works.
  - Given a revoked key, when it is revoked again, then success and `revoked_at` is unchanged.
- **Source refs:** `app/Http/Controllers/DeveloperApiController.php` (`destroy`), `resources/views/user/developers/index.blade.php`.
- **Port notes:** `POST /v2/developer/keys/:uuid/revoke` (or DELETE, same effect, no body), `permission api.keys.revoke`, `rowVersion` not needed (idempotent), status `revoked` plus `revoked_at`; use the existing `api_key_status` enum. Auth lookups cache nothing long enough to need invalidation beyond a short TTL; keep the TTL at most the rate-limit window.

### WD-API-004 — One active key per workspace

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-001
- **Summary:** A workspace may hold one live key at a time. A second create is refused until the first is revoked.
- **Actors & access:** applies to everyone creating a key.
- **UX & screens:** the create card is not shown while a key is active; a direct post flashes the error "You already have an active API key. Revoke it before creating a new one - only one key per workspace is allowed."
- **Endpoints:** same as WD-API-001.
- **Data:** counts `api_keys` rows of the workspace with `revoked_at` null.
- **Rules & edge cases:**
  1. The check counts rows with no `revoked_at`, so an expired but unrevoked key blocks a new one. QUIRK.
  2. The limit is hard-coded to one in WaDesk; there is no plan field for it.
  3. The check and the insert are not atomic in WaDesk (two simultaneous creates can both pass). QUIRK: fixed in the port with a row lock.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none in WaDesk. Ours: plan limit `api_keys` (WD-PLAN-006) is the cap; the seeded Free plan allows 1, which reproduces WaDesk's behavior; larger plans allow more by an explicit plan decision recorded in `parity/developer-rest-api-v1.md`.
- **Acceptance criteria:**
  - Given an active key, when another is created, then it is refused with the message above and no row is added.
  - Given the active key was revoked, when another is created, then it succeeds.
  - Given an expired but unrevoked key, when another is created, then it is refused (WaDesk behavior).
  - Given two creates sent at once on an empty workspace, then exactly one row exists.
- **Source refs:** `app/Http/Controllers/DeveloperApiController.php` (`store`).
- **Port notes:** use `PlanUsageService.assertCanAdd(orgId, 'api_keys')` (counts active keys, `plan-usage.service.ts`) inside the create transaction after locking the org row so concurrent creates serialize; 422 `PLAN_LIMIT_REACHED` carries the message. Decision needed from the owner: reproduce "exactly one" for every plan (set the limit to 1 everywhere) or keep the repo's seeded 1/5/20. Recorded as an open question.

### WD-API-005 — API-key authentication (Bearer or X-Api-Key)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-001
- **Summary:** Every `/api/v1` request must carry the workspace key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`. The key is looked up by its hash; the request then runs inside that key's workspace as the member who minted it.
- **Actors & access:** API clients. No workspace in the URL; the key decides it.
- **UX & screens:** none (error envelopes only).
- **Endpoints:** every `api/v1/*` route; group middleware `api`, `auth.apikey`, `auth.apikey.throttle`.
- **Data:** reads `api_keys` by `key_hash`; writes `last_used_at` on every request; reads the owner user.
- **Rules & edge cases:**
  1. Token source: bearer token first, else the `X-Api-Key` header.
  2. No token: 401 code `missing_api_key`, message tells the client to send it as a bearer token.
  3. Unknown hash, revoked key (`revoked_at` set) or expired key (`expires_at` in the past): 401 code `invalid_api_key` ("missing, revoked or expired").
  4. The key's owner no longer exists (deleted member): 401 `invalid_api_key`. A suspended or lapsed owner is not checked.
  5. The request acts as the owner with the key's workspace as current workspace (not persisted); controllers read the workspace from that.
  6. `last_used_at` is written on every call (one write per request).
  7. NOT checked (QUIRKS): `scopes` (WD-API-008), whether the workspace is deleted, whether the owner is still a member, owner role permissions, IP allowlist, trial or subscription state (WD-API-009). Failed authentications are not throttled (no brute-force limit). Responses to 401 carry no rate-limit headers.
  8. Key lookup runs before anything else, so a wrong key never reveals whether a route exists.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid key, when `GET /me` is called with `Authorization: Bearer <key>`, then 200 and the data belong to the key's workspace.
  - Given the same key in `X-Api-Key`, then the same result.
  - Given no header, then 401 `missing_api_key`.
  - Given a malformed, revoked or expired key, then 401 `invalid_api_key` and nothing is written.
  - Given a valid key, when a call succeeds, then `last_used_at` is updated.
  - Given two workspaces with one key each, when each key lists contacts, then each sees only its own workspace's contacts.
- **Source refs:** `app/Http/Middleware/AuthenticateApiKey.php`, `app/Models/ApiKey.php`, `bootstrap/app.php` (route group, alias registration).
- **Port notes:** `modules/public-api/api-key.guard.ts` already authenticates the signed partner scheme at `/public/v1` (`Authorization: ApiKey <prefix>.<secret>` + HMAC); keep it unchanged for partners. Add a bearer path for WaDesk-style keys: a second guard in `modules/developer-rest-api-v1` sharing one helper for the Redis rate limit and plan-feature check (extract from the existing guard into a service in `modules/public-api`, additive). Resolve by `key_prefix` (first 12 characters) in `db.privileged` (one of the sanctioned uses), compare sha256 in constant time, then set `ctx.orgId`, `actorType = 'api_key'`, `actorId = key.id`, `userId = key.user_id`, and `ctx.grants` (full-access synthetic grant set, WD-API-008) so existing services that read `ctx.grants!` work. Do not alter `ctx` semantics in the kernel; set fields only. `last_used_at` is written fire-and-forget at most once per minute per key (a deliberate deviation: one write per call would be a hot row; documented as intended). Add a failed-auth throttle per client IP (security hardening, documented). Mount paths are `api/v1/...` with `VERSION_NEUTRAL`.

### WD-API-006 — Per-key rate limit (plan, platform default, unlimited)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-005, WD-PLAN-022
- **Summary:** Each key is held to a number of requests per minute that comes from the workspace's plan, else the platform default (600), with 0 meaning unlimited. Over the limit the API answers 429 with a retry hint.
- **Actors & access:** every key-authenticated request.
- **UX & screens:** none (headers and 429 body).
- **Endpoints:** applies to all `api/v1/*` after authentication.
- **Data:** counter per key and 60-second window (cache in WaDesk, Redis in the port).
- **Rules & edge cases:**
  1. Effective limit, in order: the workspace's effective `api_rate_limit_per_minute` (per-workspace override, platform-admin-owned workspaces, add-ons stacked); a negative value means unlimited; a positive value is the limit; zero falls through to the platform default `security.api_rate_limit_per_minute` (600 when unset); a global 0 means unlimited. A limit of zero or less means no throttle and no headers.
  2. The bucket is per key, not per workspace.
  3. At the limit: 429 code `rate_limited` ("Rate limit of N requests/minute for your plan exceeded. Retry in Ns.") with `Retry-After`, `X-RateLimit-Limit` and `X-RateLimit-Remaining: 0`. A refused request is not counted as an extra hit.
  4. Successful responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`.
  5. QUIRK: the WaDesk docs page says "No hard request limit is enforced today"; the real default is 600 per minute.
  6. QUIRK: WaDesk uses a 60-second sliding window; the port uses a fixed minute window (documented deviation: one INCR per request).
- **Async & events:** none.
- **External systems:** Redis (ours).
- **Settings:** platform `security.api_rate_limit_per_minute` (default 600), plan `api_rate_limit_per_minute` (0 = use the platform default, WD-API-011).
- **Acceptance criteria:**
  - Given a plan limit of 3, when a key makes 4 calls inside a minute, then the fourth gets 429 `rate_limited` with `Retry-After`.
  - Given a successful call, then `X-RateLimit-Limit` and `X-RateLimit-Remaining` are present and remaining decreases by one per call.
  - Given a workspace override of -1, when it makes 1000 calls, then none is throttled and no headers are added.
  - Given plan limit 0 and platform default 600, then the limit is 600.
  - Given two keys of two workspaces, then one's usage does not count for the other.
- **Source refs:** `app/Http/Middleware/ApiPlanRateLimit.php`, `app/Http/Controllers/Admin/SecurityController.php`, `database/migrations/2026_06_24_140000_*` (package column).
- **Port notes:** already built for the signed scheme in `public-api/api-key.guard.ts` (`effectiveRateLimit`, plan entitlement and `SecurityPolicyService`); reuse by extraction into one service shared with the bearer guard. Key column `rate_limit_per_minute` (default 120) is the per-key cap that sits under the plan and platform ceiling (`min(key, ceiling)`). For parity the console-minted key must not carry a lower cap than WaDesk's: mint bearer keys with `rate_limit_per_minute = 0` (inherit) and treat 0 as "no key-level cap"; migration adjusts the default for `kind = 'bearer'`. Redis down: fail open (log), as the existing guard does.

### WD-API-007 — Response and error envelopes, validation rendering

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-005
- **Summary:** Every v1 answer has the same shape: success is `{ data, meta? }`, failure is `{ error: { code, message, details? } }`, with fixed machine codes.
- **Actors & access:** all API clients.
- **UX & screens:** none.
- **Endpoints:** all `api/v1/*`.
- **Data:** none.
- **Rules & edge cases:**
  1. Success: HTTP 200 (201 on create) with `data`; `meta` only when there is something to say (pagination counts, available events).
  2. Failure body: `error.code` (stable snake_case), `error.message` (human), `error.details` only when non-empty. Codes seen: `missing_api_key`, `invalid_api_key`, `rate_limited`, `not_found`, `plan_feature_disabled` (403, deals), `plan_limit` (402, campaigns), `unsupported_media_type` (422, uploads), plus the inner codes of delegated controllers (see each resource).
  3. QUIRK: validation failures do NOT use this shape in WaDesk. They use Laravel's default `{ message, errors: { field: [..] } }` with 422 only when the client sends `Accept: application/json`; without it the response is a 302 redirect. Unknown route (404) and wrong method (405) also use Laravel's default `{ message }` body, or an HTML page without the Accept header. Plan-limit exceptions use a third shape (`{ ok:false, error:"plan_limit_reached", reason, key, used, limit, message }`).
  4. IDs in responses are integers in WaDesk; timestamps are ISO-8601.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a missing key, then the body is `{ "error": { "code": "missing_api_key", "message": ... } }` with 401.
  - Given an unknown id, then 404 with `error.code = not_found`.
  - Given an invalid request body, then 422 with the validation errors listed (one entry per failing field) whatever the Accept header.
  - Given a list call, then the body has `data` (array) and `meta`.
  - Given a request for a route that does not exist under `/api/v1`, then 404 in the same envelope, never HTML.
- **Source refs:** `app/Http/Controllers/Api/V1/V1Controller.php`, `bootstrap/app.php` (exception handling), `app/Exceptions/PlanLimitReachedException.php`.
- **Port notes:** a filter attached to the v1 controllers renders AppError and Nest errors as `{ error: { code, message, details } }` and maps our codes to WaDesk's snake_case (`API_KEY_INVALID` to `invalid_api_key` or `missing_api_key`, `RATE_LIMITED` to `rate_limited`, `NOT_FOUND` to `not_found`, `VALIDATION_FAILED` to `validation_failed` with `details` as `{ field: [messages] }`, `PLAN_FEATURE_LOCKED` to `plan_feature_disabled`, `PLAN_LIMIT_REACHED` to `plan_limit`), and always returns 422 for validation (the WaDesk redirect without Accept is a bug fix, documented as intended). `requestId` is added to every error body and echoed in `x-request-id`. Documented deviations from architecture: ids are uuids; lists are cursor based (`meta` carries `limit`, `next_cursor`, `has_more` instead of `page`, `per_page`, `total`, `last_page`; `per_page` is accepted as an alias of `limit`; `page` answers 422 asking for a cursor). Contracts: `packages/contracts/src/developer-rest-api-v1/envelope.ts`.

### WD-API-008 — Key scopes

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-API-005
- **Summary:** WaDesk's key model carries a `scopes` list and a `hasScope()` check where an empty list means full access, but nothing ever sets scopes or calls the check; every key is full access.
- **Actors & access:** none reachable.
- **UX & screens:** none; the console cannot choose scopes.
- **Endpoints:** none.
- **Data:** `api_keys.scopes` (json, always null).
- **Rules & edge cases:**
  1. Empty or null scopes = full access; a non-empty list would restrict by name (never used, no scope names are defined anywhere).
  2. QUIRK: documented in the code docblock ("null scopes = full access") and nowhere else.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a key minted in the console, when it calls any v1 endpoint it can reach, then no scope check blocks it.
  - Given a key whose scopes list is empty, then it has full access.
  - Given a key that carries a scope list (port hardening, not in WaDesk), when it calls a route outside its scopes, then 403 in the v1 envelope.
- **Source refs:** `app/Models/ApiKey.php` (`hasScope`), `app/Http/Controllers/Api/V1/V1Controller.php`.
- **Port notes:** the table has `scopes text[]` (empty = full). The port keeps behavior (console keys are full access) and adds enforcement for keys that do carry scopes as a security hardening, documented as intended: scope names `<resource>:read` and `<resource>:write`, checked by a route decorator in the bearer guard. Full access also yields the synthetic `ctx.grants` that delegated services need (WD-API-005). No console control for scopes (that would be a new feature).

### WD-API-009 — Plan and lifecycle gates on the public API

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-API-005, WD-PLAN-001
- **Summary:** WaDesk has no plan feature for "API access": any workspace on any plan, even a lapsed one, can mint keys and call the API; only the rate limit varies by plan, and Deals answers 403 when the plan lacks the sales pipeline.
- **Actors & access:** every key.
- **UX & screens:** none.
- **Endpoints:** all v1; the Deals routes carry the 403.
- **Data:** plan features and overrides.
- **Rules & edge cases:**
  1. Deals: no `access_sales_pipeline` feature gives 403 `plan_feature_disabled` ("Your plan doesn't include the Sales Pipeline. Upgrade to unlock the deals API."); platform-admin-owned workspaces bypass.
  2. Campaign create converts a plan-limit exception to 402 `plan_limit`.
  3. The docs say API access is a paid plan feature; the code does not enforce it. QUIRK (docs-only claim).
  4. Trial expiry, subscription lapse, user suspension and workspace deletion do not stop a key. Keys of a soft-deleted owner fail (WD-API-005 rule 4). QUIRK.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan feature `access_sales_pipeline`; ours also `public_api` (plan feature, default on) and `outbound_webhooks`.
- **Acceptance criteria:**
  - Given a plan without the sales pipeline, when a key calls `GET /deals`, then 403 `plan_feature_disabled`.
  - Given a plan with it, then 200.
  - Given a plan with `public_api` turned off, when a key calls any v1 endpoint, then the plan-feature error is returned (ours: hardening on top of WaDesk, documented).
  - Given a workspace with an expired trial, when a key calls the API, then WaDesk does not block it (parity-file note: ours blocks via the plan/trial guards if the owner decides).
- **Source refs:** `app/Http/Controllers/Api/V1/DealController.php`, `app/Services/PlanLimitGuard.php`, `routes/api/v1/deals.php`.
- **Port notes:** the existing `ApiKeyGuard` enforces `@RequirePlanFeature('public_api')` after the key resolves; app-wide plan and trial guards skip `@Public()` routes, so trial-expired workspaces are not blocked (matches WaDesk). Gap to fix in this domain: apply `@RequirePlanFeature('public_api')` to the v1 controllers (also the flows controllers that exist at `public/v1/flows`, a one-line additive change in the FLR zone, requested through the owner). Deals gate: `SalesPipelineGuard`/`DealsPlan.assertEnabled(orgId)` mapped to `plan_feature_disabled`. Open question for the owner: whether `public_api` off should lock the console as well (WaDesk never does).

### WD-API-010 — Developers entry in the menu and who may open the console

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-API-002
- **Summary:** "REST API" sits in the Developer group of the user menu, visible to workspace owners and admins on every plan. The console URL itself accepts any signed-in member.
- **Actors & access:** menu: owner or admin tier. Routes: any signed-in member (QUIRK: an agent who types `/developers` can list, create and revoke keys).
- **UX & screens:** menu item "REST API" linking to `/developers`; the docs page tells users to look under "More, Developers / API".
- **Endpoints:** `GET developers` (WD-API-002).
- **Data:** none.
- **Rules & edge cases:**
  1. The nav item has no plan feature gate, so it shows on all plans.
  2. The route group has no role middleware. QUIRK.
  3. Demo mode, trial-expired and maintenance middlewares of the web stack may block mutations.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an owner or admin, when the menu opens, then "REST API" is listed and opens the console.
  - Given an agent, then the item is hidden (and, in the port, the console refuses the request, see Port notes).
  - Given a plan without the Public API feature, then the item is shown locked (ours).
- **Source refs:** `app/Support/UserNav.php` (developers item), `routes/web.php` (developers routes).
- **Port notes:** the Settings tile `rest-api` (`/developers`, section integrations) is already declared in `features/_registry/settings-planned.ts`; replace it by `features/developer-rest-api-v1/settings.ts` with `gates: { permission: 'api.keys.read', planFeature: 'public_api' }`. Fixing the role QUIRK is a documented hardening: the port requires `api.keys.*` permissions (granted to Owner and Admin roles by migration), so an agent cannot manage keys.

### WD-API-011 — API rate-limit settings (platform default, per plan)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-API-006
- **Summary:** Operators set the default requests-per-minute for everyone in the Security settings and may give each plan its own number.
- **Actors & access:** platform admin.
- **UX & screens:** Admin, Security, tab "API and webhooks": a numeric field for the per-minute rate limit (integer 1 to 100000, default 600). Admin packages form: field "API rate limit / min (0 = default)" in the "Other caps" group.
- **Endpoints:** Security settings save (admin) and package create/edit (admin); owned by the settings and plans domains.
- **Data:** setting `security.api_rate_limit_per_minute`; package column `api_rate_limit_per_minute` (default 0).
- **Rules & edge cases:**
  1. QUIRK: the Security form's minimum is 1, so "0 = unlimited" cannot be set globally from the UI although the middleware honours it.
  2. A plan value of -1 means unlimited.
  3. The security score counts a positive limit as a hardening item.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the two above.
- **Acceptance criteria:**
  - Given the platform default saved as 100, when a key on a plan with limit 0 calls the API, then the limit is 100.
  - Given a plan limit of 20, then the plan wins over the platform default.
  - Given a value of 0 for the platform default saved through the database, then calls are not throttled.
- **Source refs:** `app/Http/Controllers/Admin/SecurityController.php`, `resources/views/admin/security/index.blade.php`, `app/Models/Package.php`.
- **Port notes:** already ported by the plans and security domains (`SecurityPolicyService.apiRateLimitPerMinute`, plan limit key `api_rate_limit_per_minute`, WD-PLAN-006 and WD-PLAN-022 are `done`). This domain only consumes it; record as consumer in the wiring map.

### WD-API-020 — GET /me - workspace, plan, limits, features

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-005, WD-PLAN-001
- **Summary:** The client reads who it is acting as, which workspace, which plan, the numeric limits and the unlocked features.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint | Route name | Controller@action           | Middleware                 | Request fields | Response                                                   |
| -------- | ---------- | --------------------------- | -------------------------- | -------------- | ---------------------------------------------------------- |
| GET me   | api.v1.me  | Api\V1\AccountController@me | api, auth.apikey, throttle | none           | `{ data: { account, workspace, plan, limits, features } }` |

- **Data:** workspace row, plan summary (`PlanUsage::summary`), effective limits per meter key.
- **Rules & edge cases:**
  1. `account`: `name` and `email` of the key's owner (may be null).
  2. `workspace`: `id`, `name`, `slug`, `timezone`, `currency`.
  3. `plan`: `id`, `name`, `is_free`.
  4. `limits`: one entry per curated meter key; a value of 0 or blank is shown as `null` (unlimited), otherwise the integer.
  5. `features`: an object of `<feature_key>: true` for every unlocked feature.
  6. Workspace not found: 404 `not_found` ("Workspace not found.").
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan definitions and per-workspace overrides.
- **Acceptance criteria:**
  - Given a key, when `GET /me` is called, then `workspace` carries the key's workspace and `plan` its plan.
  - Given a plan with a message cap of 1000, then `limits.<messages key>` is 1000; with no cap it is `null`.
  - Given a plan feature turned on, then it appears in `features` as `true`; features that are off are absent.
  - Given a key whose workspace is gone, then 404.
- **Source refs:** `app/Http/Controllers/Api/V1/AccountController.php` (`me`), `app/Services/PlanUsage.php`, `routes/api/v1/account.php`.
- **Port notes:** build from `PlanEntitlementService.forOrg` and `PlanUsageService.usage(orgId)` (both exported) plus `organizations` and its `settings` json (`timezone`, `currency`); the workspace id is the org uuid. The contract lives in `packages/contracts/src/developer-rest-api-v1/account.ts`.

### WD-API-021 — GET /usage - message cycle, plan validity, meters, credits

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-005, WD-PLAN-006, WD-WALLET-001
- **Summary:** The client reads how many messages were sent this billing month, how many remain, when the cycle resets, when the plan ends, the wallet credits and every usage meter.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint  | Route name   | Controller@action              | Middleware                 | Request fields | Response                                                |
| --------- | ------------ | ------------------------------ | -------------------------- | -------------- | ------------------------------------------------------- |
| GET usage | api.v1.usage | Api\V1\AccountController@usage | api, auth.apikey, throttle | none           | `{ data: { period, plan, messages, credits, meters } }` |

- **Data:** plan usage summary and the owner's wallet.
- **Rules & edge cases:**
  1. `period`: `label` (month label), `resets_on` (cycle reset date), `days_left`.
  2. `plan`: `name`, `valid_until` (subscription expiry; null = none), `valid_until_days`. This is plan validity, distinct from the monthly message cycle.
  3. `messages`: `used`, `limit` (null when unlimited), `unlimited`, `remaining`, `percent`.
  4. `credits`: wallet credits of the workspace owner.
  5. `meters`: per key `{ label, used, limit (null = unlimited), unlimited, percent }`; the summary's `pct` is exposed as `percent`.
  6. Workspace not found: 404.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan limits.
- **Acceptance criteria:**
  - Given 40 of 100 messages used, then `messages.used` is 40, `remaining` 60, `percent` 40.
  - Given an unlimited plan, then `messages.limit` is `null` and `unlimited` true.
  - Given a plan with an end date, then `plan.valid_until` is set and `valid_until_days` counts down.
  - Given a wallet balance, then `credits` reflects it.
  - Given a meter with a cap, then its entry has `limit` and `percent`.
- **Source refs:** `app/Http/Controllers/Api/V1/AccountController.php` (`usage`), `app/Services/PlanUsage.php`.
- **Port notes:** `PlanUsageService.usage(orgId)` gives plan, validity, meters, cycle reset; wallet credits come from `WalletQueryService.summary()`, which is not exported yet (additive export in the wallet zone, requested via its owner) or `WalletLedgerService` balance. `credits` stays an integer count in WaDesk; ours is currency minor units, so expose both `credits` (minor units as a string, money rule) and `currency`. Documented as intended.

### WD-API-022 — GET /contacts - list with search

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-005, WD-CON-001
- **Summary:** The client lists the workspace's contacts, newest first, optionally filtered by a search text.
- **Actors & access:** any key; full workspace visibility.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint     | Route name            | Controller@action              | Middleware                 | Request fields                                    | Response                                                          |
| ------------ | --------------------- | ------------------------------ | -------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| GET contacts | api.v1.contacts.index | Api\V1\ContactController@index | api, auth.apikey, throttle | `search`, `page`, `per_page` (1..100, default 25) | `{ data: [contact], meta: { page, per_page, total, last_page } }` |

- **Data:** contacts of the workspace, newest first by creation time.
- **Rules & edge cases:**
  1. `per_page` is clamped to 1..100 (default 25); `page` is at least 1.
  2. `search` is trimmed and matches case-insensitively as a substring of name, mobile or email (WaDesk loads all rows and filters in memory because the fields are encrypted at rest).
  3. Contact shape: `id`, `name`, `phone` (normalized to a leading plus and digits only; null when empty), `email`, `tags` (list of `{ id, name }` of the contact's groups, resolved inside the same workspace), `attributes` (object, `{}` when none), `created_at` (ISO-8601).
  4. `meta.total` is the count after search; `last_page` is at least 1.
  5. A group id from another workspace is never resolved into a name.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 30 contacts, when listed with `per_page=10`, then 10 contacts come back newest first with a continuation to the next page.
  - Given `search=ali`, then only contacts whose name, phone or email contains "ali" (any case) are returned.
  - Given `per_page=1000`, then at most 100 are returned.
  - Given a contact in two groups, then `tags` lists both with id and name.
  - Given a contact with phone `91 98123 45678`, then `phone` is `+919812345678`.
  - Given another workspace's contacts, then none appear.
- **Source refs:** `app/Http/Controllers/Api/V1/ContactController.php` (`index`), `app/Http/Resources/Api/V1/ContactResource.php`, `routes/api/v1/contacts.php`.
- **Port notes:** `ContactsService.list(query, 'all')` with an explicit full scope (do not use `@GrantedScope`, it defaults to `own` without grants). Search maps to the existing `q` filter (the target stores plain text, so it is a SQL match, not an in-memory scan). Cursor pagination replaces `page` (documented: ids are uuids and `meta` carries `limit`, `next_cursor`, `has_more`; `total` is dropped because the platform forbids a COUNT over contacts; the list may offer `meta.total` only if the service already has a cheap count). `tags` come from contact groups (WaDesk's "groups"); `attributes` from the contact's custom-field values (`data` jsonb).

### WD-API-023 — GET /contacts/{id}

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-022
- **Summary:** The client reads one contact.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint          | Route name           | Controller@action             | Middleware                 | Request fields | Response                   |
| ----------------- | -------------------- | ----------------------------- | -------------------------- | -------------- | -------------------------- |
| GET contacts/{id} | api.v1.contacts.show | Api\V1\ContactController@show | api, auth.apikey, throttle | id numeric     | `{ data: contact }` or 404 |

- **Data:** one contact of the workspace.
- **Rules & edge cases:**
  1. Not in this workspace or not existing: 404 `not_found` ("Contact not found."), never a hint that the id exists elsewhere.
  2. A non-numeric id does not match the route (404).
  3. Same resource shape as WD-API-022.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact, when read by id, then 200 with the shape of WD-API-022.
  - Given an id of another workspace, then 404 `not_found`.
  - Given an unknown id, then 404 `not_found`.
- **Source refs:** `app/Http/Controllers/Api/V1/ContactController.php` (`show`).
- **Port notes:** `ContactsService.getByUuid` reads `ctx.grants!` and `ctx.userId!` and cannot serve a key as is; the synthetic full-access grant set (WD-API-005) makes it work unchanged. Id is the contact uuid; a malformed uuid answers 404 in the v1 envelope (not 400).

### WD-API-024 — POST /contacts

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-022, WD-CON-001
- **Summary:** The client creates a contact with name, phone, email, groups and free-form attributes.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint      | Route name            | Controller@action              | Middleware                 | Request fields                                                                                                                                                                      | Response                |
| ------------- | --------------------- | ------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| POST contacts | api.v1.contacts.store | Api\V1\ContactController@store | api, auth.apikey, throttle | `name`, `first_name`, `middle_name`, `last_name`, `title`, `phone` (required), `country_code`, `email`, `language`, `address`, `note`, `group_ids`, `attributes`, `is_unsubscribed` | 201 `{ data: contact }` |

- **Data:** writes a contact for the workspace, attributed to the key's owner.
- **Rules & edge cases:**
  1. `name`: required when `first_name` is absent; string max 191. `first_name`, `middle_name`, `last_name` max 191 each; `title` max 50.
  2. `phone`: required string max 32. `country_code` string max 10; when set and the phone does not already start with it, it is prefixed with a space.
  3. `email`: valid email max 191. `language` max 80, `address` max 1000, `note` max 2000.
  4. `group_ids`: array of integers; each must be a group of this workspace, otherwise validation fails (a foreign group id is rejected, no cross-workspace link).
  5. `attributes`: free-form key/value object, stored as the contact's custom attributes (empty becomes none). `is_unsubscribed`: boolean, default false.
  6. Display name: the given `name`, else title, first, middle and last name joined by single spaces.
  7. A contact-created webhook event fires (single create only; bulk import stays silent).
  8. No duplicate check by phone in WaDesk. QUIRK: two creates with the same phone make two contacts. (Ours resolves identity first, see Port notes.)
- **Async & events:** webhook event `contact_created` with workspace, owner, contact id, name, digits-only phone, email and timestamp.
- **External systems:** none.
- **Settings:** plan contact quota (ours).
- **Acceptance criteria:**
  - Given `phone` only, when posted, then 422 because neither `name` nor `first_name` is present.
  - Given `name` and `phone`, then 201 with the contact, `phone` normalized.
  - Given `first_name`, `last_name` and `title`, then `name` is the three joined.
  - Given a `group_ids` entry of another workspace, then 422 naming `group_ids.0`.
  - Given `country_code=+91` and `phone=9812345678`, then the stored number is `+91 9812345678` and the API returns `+919812345678`.
  - Given a subscribed webhook for `contact_created`, then one delivery is queued.
  - Given an email of 192 characters, then 422.
- **Source refs:** `app/Http/Controllers/Api/V1/ContactController.php` (`store`), `app/Http/Requests/Api/V1/Contact/StoreContactRequest.php`, `app/Services/WebhookService.php`.
- **Port notes:** `ContactsService.create` already resolves identity (email, phone) and returns the existing contact instead of a duplicate; the 201-with-existing answer is a documented deviation (data safety; WaDesk would duplicate), the response carries `created: false` in `meta` when matched. Map: `phone` to identity phone (E.164 normalization lives in the contact module), `attributes` to custom fields (unknown keys are kept verbatim as `data`), `group_ids` (uuids) through `ContactGroupsService.setGroupsOfContact` after create inside the same request (not the same transaction: file the follow-up if atomicity matters). Event `contact.created` already goes through the outbox in `ContactsService.create`; the webhook delivery itself is the INTG domain (WD-API-140 family). Idempotency-Key honoured on POST.

### WD-API-025 — PUT /contacts/{id}

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-023
- **Summary:** The client changes only the fields it sends; everything else stays.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint          | Route name             | Controller@action               | Middleware                 | Request fields (all optional)                                                                                                                                            | Response                |
| ----------------- | ---------------------- | ------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| PUT contacts/{id} | api.v1.contacts.update | Api\V1\ContactController@update | api, auth.apikey, throttle | `name`, `first_name`, `middle_name`, `last_name`, `title`, `phone`, `country_code`, `email`, `language`, `address`, `note`, `group_ids`, `attributes`, `is_unsubscribed` | 200 `{ data: contact }` |

- **Data:** updates the contact.
- **Rules & edge cases:**
  1. Only keys present in the body change; a key sent as null clears nullable fields.
  2. Same field rules as WD-API-024 except nothing is required.
  3. The display name is recomputed only when `name` or `first_name` is in the body: `name` wins, else the parts joined; an empty result keeps the old name.
  4. `phone` is re-composed with the sent `country_code`, else the stored one.
  5. `group_ids` replaces the whole set; `attributes` replaces the whole object (empty clears); `note` maps to the contact's note.
  6. Not found or other workspace: 404.
  7. No webhook fires (WaDesk emits `contact_updated` only from the in-app screen, QUIRK: the docs list `contact_updated` as an event).
- **Async & events:** none in WaDesk.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact, when only `email` is sent, then the email changes and the name is untouched.
  - Given `group_ids: []`, then the contact leaves all groups.
  - Given `attributes: {}`, then attributes are cleared.
  - Given an unknown id, then 404.
  - Given a foreign group id, then 422.
  - Given `phone` with a new `country_code`, then the stored number uses the new code.
- **Source refs:** `app/Http/Controllers/Api/V1/ContactController.php` (`update`), `app/Http/Requests/Api/V1/Contact/UpdateContactRequest.php`.
- **Port notes:** our `updateContactSchema` requires `rowVersion`; the API does not take it: the controller reads the current row, merges the sent fields and calls `ContactsService.update` with the version it just read, retrying once on `ROW_VERSION_CONFLICT` (documented: the HTTP verb stays PUT with partial semantics, as in WaDesk; `PATCH` is accepted as an alias). Emit `contact.updated` through the existing service so subscribers and webhooks see it (documented as intended, WaDesk's docs list the event).

### WD-API-026 — DELETE /contacts/{id}

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-023
- **Summary:** The client deletes a contact.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint             | Route name              | Controller@action                | Middleware                 | Request fields | Response                              |
| -------------------- | ----------------------- | -------------------------------- | -------------------------- | -------------- | ------------------------------------- |
| DELETE contacts/{id} | api.v1.contacts.destroy | Api\V1\ContactController@destroy | api, auth.apikey, throttle | id numeric     | 200 `{ data: { id, deleted: true } }` |

- **Data:** removes the contact (WaDesk soft-deletes through the model).
- **Rules & edge cases:**
  1. Not found or other workspace: 404.
  2. Response echoes the id and `deleted: true`.
  3. Group memberships live on the contact, so nothing else needs cleanup in WaDesk.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact, when deleted, then 200 `{ data: { id, deleted: true } }` and a later read is 404.
  - Given a contact of another workspace, then 404 and it remains.
  - Given a deleted contact, when deleted again, then 404.
- **Source refs:** `app/Http/Controllers/Api/V1/ContactController.php` (`destroy`).
- **Port notes:** `ContactsService.remove` (hard delete with audit, repo rule); respond 200 with the same body (not 204) to keep the WaDesk contract; the v2 staff route answers 204, so the controller shapes its own body.

### WD-API-027 — GET /contact-groups

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-005, WD-CON-001
- **Summary:** The client lists the workspace's contact groups with the number of contacts in each.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint           | Route name                  | Controller@action                   | Middleware                 | Request fields | Response                             |
| ------------------ | --------------------------- | ----------------------------------- | -------------------------- | -------------- | ------------------------------------ |
| GET contact-groups | api.v1.contact-groups.index | Api\V1\ContactGroupController@index | api, auth.apikey, throttle | none           | `{ data: [group], meta: { count } }` |

- **Data:** groups of the workspace, newest first; member counts.
- **Rules & edge cases:**
  1. Group shape: `id`, `name`, `note`, `color`, `contacts_count`, `created_at`.
  2. `contacts_count` counts the workspace's contacts that reference the group.
  3. No pagination (the whole list), `meta.count` is the length.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two groups, then both are listed newest first.
  - Given 3 contacts in a group, then its `contacts_count` is 3.
  - Given another workspace's group, then it is not listed.
- **Source refs:** `app/Http/Controllers/Api/V1/ContactGroupController.php` (`index`), `app/Http/Resources/Api/V1/ContactGroupResource.php`.
- **Port notes:** `ContactGroupsService.list`; member count comes from the group's membership table (the service already returns counts for the staff screen; confirm). Cursor list in the port (documented), default `limit` high enough to match "the whole list" for ordinary workspaces.

### WD-API-028 — POST /contact-groups

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-027
- **Summary:** The client creates a group.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint            | Route name                  | Controller@action                   | Middleware                 | Request fields                                          | Response              |
| ------------------- | --------------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------------- | --------------------- |
| POST contact-groups | api.v1.contact-groups.store | Api\V1\ContactGroupController@store | api, auth.apikey, throttle | `name` required max 191; `note` max 500; `color` max 32 | 201 `{ data: group }` |

- **Data:** a group row for the workspace, attributed to the key's owner.
- **Rules & edge cases:**
  1. `name` required, max 191; `note` max 500; `color` max 32 (hex or token).
  2. No uniqueness check on `name` in WaDesk (QUIRK: two groups with the same name are allowed).
  3. New group has `contacts_count` 0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a name, then 201 with `contacts_count: 0`.
  - Given no name, then 422.
  - Given a name of 192 characters, then 422.
  - Given the same name twice, then two groups exist (unless the port's uniqueness rule applies; see Port notes).
- **Source refs:** `app/Http/Controllers/Api/V1/ContactGroupController.php` (`store`), `app/Http/Requests/Api/V1/Group/StoreContactGroupRequest.php`.
- **Port notes:** `ContactGroupsService.create`; if the target enforces unique group names, mirror its error and record it as an intended deviation.

### WD-API-029 — DELETE /contact-groups/{id}

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-027
- **Summary:** The client deletes a group; every contact that was in it is detached first.
- **Actors & access:** any key.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint                   | Route name                    | Controller@action                     | Middleware                 | Request fields | Response                              |
| -------------------------- | ----------------------------- | ------------------------------------- | -------------------------- | -------------- | ------------------------------------- |
| DELETE contact-groups/{id} | api.v1.contact-groups.destroy | Api\V1\ContactGroupController@destroy | api, auth.apikey, throttle | id numeric     | 200 `{ data: { id, deleted: true } }` |

- **Data:** removes the group and its membership from every workspace contact.
- **Rules & edge cases:**
  1. Not found or other workspace: 404 `not_found` ("Contact group not found.").
  2. The detach only touches the workspace's own contacts.
  3. Contacts keep existing; only the membership goes.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a group with 3 contacts, when deleted, then 200 and the 3 contacts no longer list the group in `tags`.
  - Given a group of another workspace, then 404 and nothing changes.
  - Given the contacts, then they still exist.
- **Source refs:** `app/Http/Controllers/Api/V1/ContactGroupController.php` (`destroy`).
- **Port notes:** `ContactGroupsService.remove`; membership rows cascade by foreign key. Respond 200 with the body above.

### WD-API-030 — GET /templates: list templates

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-TPL-004
- **Summary:** An API client lists the workspace's WhatsApp message templates, newest first, so it can pick one to send. The list is limited to templates that are actually sendable on the workspace's engine and the response shows only a trimmed public shape.
- **Actors & access:** any valid API key; no permission keys, no plan gate, no scope check. Workspace comes from the key.
- **UX & screens:** none.
- **Endpoints:**

| Method uri           | Route name             | Controller@action               | Middleware                             | Request        | Response                                                                |
| -------------------- | ---------------------- | ------------------------------- | -------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| GET api/v1/templates | api.v1.templates.index | Api\V1\TemplateController@index | api, auth.apikey, auth.apikey.throttle | none effective | 200 `{data:[template], meta:{count}}`; 422 `list_failed` on inner error |

- **Data:** reads `wa_templates` (visible set: workspace-owned rows, plus admin-seeded globals with no workspace and no owner, plus legacy rows with no workspace owned by the key's user), `wa_provider_configs` (live-number check, sender key), `users` (creator name inside the inner payload, not exposed). Ordered by id descending. No pagination or limit. Public template shape: `id`, `name`, `type` (standard, carousel, media, auth, catalog), `category`, `language`, `header`, `header_location` ({latitude, longitude, name?, address?} strings or null), `body`, `footer`, `buttons` (array, empty array when none), `carousel_data`, `attachment_type` (image, video, audio, document, location or null), `status` (local status: pending, approved, rejected, public), `created_at`, `updated_at` (ISO-8601).
- **Rules & edge cases:**
  1. The "sendable" filter is always on. The v1 wrapper builds the internal request with no query string, so the app-level options `sendable=0`, `account_id` and `sender_key` can never be passed; clients cannot list unapproved templates. QUIRK:
  2. On a WABA-engine workspace sendable means: Meta template id present AND `meta_status` APPROVED AND not paused (paused_until empty or past). On other engines it means local `status` in approved or public.
  3. Templates tied to a WABA number whose provider config is not connected (disconnected or deleted) are hidden; templates with no provider config are always kept.
  4. QUIRK: a template created through `POST /templates` has no Meta template id, so on a WABA workspace it never appears here yet is readable via `GET /templates/{id}`; list and show disagree.
  5. QUIRK: the public shape omits `meta_status`, Meta template id, quality, `variable_map`, attachment URL, sender key and creator. Clients cannot see Meta approval state, only the synthetic local `status`.
  6. Empty workspace returns `data: []` with `meta.count` 0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none specific (rate limit per WD-API-006).
- **Acceptance criteria:**
  - Given a workspace with three sendable templates, when GET /templates, then 200 with three items ordered newest first and `meta.count` 3.
  - Given a WABA workspace and a template without a Meta template id, when listing, then that template is absent.
  - Given a template whose WABA number is disconnected, when listing, then it is absent; given a template with no number, then it is present.
  - Given another workspace's template, when listing, then it is never returned; an admin-seeded global template is returned.
  - Given a missing or revoked API key, then 401 with the standard error envelope.
- **Source refs:** routes/api/v1/templates.php, app/Http/Controllers/Api/V1/TemplateController.php, app/Http/Controllers/Api/App/TemplateController.php, app/Http/Resources/Api/V1/TemplateResource.php, app/Models/WaTemplate.php
- **Port notes:** target has `TemplatesService.list(query)` and `get(uuid)` in `apps/api/src/modules/message-templates` (barrel exports `TemplatesService`); both are usable by an api-key actor (no grants). Needs a new public controller (`@Public()`, `ApiKeyGuard`, version-neutral) and a mapper to the trimmed shape; contracts live in `packages/contracts/src/message-templates/templates.ts`. Decide whether to keep the always-sendable filter or add a `status` filter (WaDesk cannot). Responses must use uuids, not bigint ids. Admin-seeded global templates have no equivalent concept in a tenant-scoped (RLS) model; decide explicitly.

### WD-API-031 — GET /templates/categories: static category list

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007
- **Summary:** Returns the three Meta template categories so a client knows what numeric category ids the create endpoint understands.
- **Actors & access:** any valid API key; no gates.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                      | Route name                  | Controller@action                    | Middleware                             | Request | Response                                                                                            |
| ------------------------------- | --------------------------- | ------------------------------------ | -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| GET api/v1/templates/categories | api.v1.templates.categories | Api\V1\TemplateController@categories | api, auth.apikey, auth.apikey.throttle | none    | 200 `{data:[{id:1,name:"Marketing"},{id:2,name:"Authentication"},{id:3,name:"Utility"}]}` (no meta) |

- **Data:** none; constant list.
- **Rules & edge cases:**
  1. Order is fixed: 1 Marketing, 2 Authentication, 3 Utility.
  2. QUIRK: these ids are only an input convenience for `POST/PUT /templates` (`category` accepts 1/2/3). The `category` returned on a template is an industry bucket, not one of these three (see WD-API-032).
  3. The route is declared before `/templates/{id}`; because `{id}` is digits-only, there is no clash.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid key, when GET /templates/categories, then 200 with exactly three items with ids 1, 2, 3.
  - Given no key, then 401 `missing_api_key`.
  - Given the response, then there is no `meta` member.
  - Given a request to /templates/categories, then it is not treated as a template id lookup.
- **Source refs:** app/Http/Controllers/Api/V1/TemplateController.php, app/Http/Controllers/Api/App/TemplateController.php
- **Port notes:** static constant in the public controller; contracts name suggestion `templateCategoryListSchema`. No DB.

### WD-API-032 — POST /templates: create a template (local only, no Meta submission)

- **Status:** partial (creates a local row marked approved; never submits to Meta)
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-005, WD-API-007, WD-TPL-007, WD-TPL-008
- **Summary:** An API client creates a template record in the workspace with name, body, optional header, footer, buttons, carousel and a location header. The record is stored as already approved locally; nothing is sent to Meta.
- **Actors & access:** any valid API key; no plan gate and no template-count limit on this path; attachment (image/video/document header files) is not supported here, only through the dashboard.
- **UX & screens:** none.
- **Endpoints:**

| Method uri            | Route name             | Controller@action               | Middleware                             | Request                                                                                                                                                                                               | Response                                                                                      |
| --------------------- | ---------------------- | ------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| POST api/v1/templates | api.v1.templates.store | Api\V1\TemplateController@store | api, auth.apikey, auth.apikey.throttle | template_name, template_type, category, header, template_body, footer, language, buttons, quick_replies, carousel_data, code_expiration_minutes, latitude, longitude, location_name, location_address | 201 `{data: template}`; 422 validation; 422 `create_failed` with details from the inner layer |

- **Data:** writes `wa_templates` (encrypted at rest: name, header, body, footer, buttons, carousel, variable map, header location). Stamped values: owner user = key owner, workspace = key workspace, `status` approved, `meta_status` APPROVED, `approved_at` now. Not set: provider config, Meta template id, Twilio content sid, submitted time, quality score, parameter format. Also writes an in-app `notifications` row (WD-API-035 side effect shared via the model's change-notification trait, honoring workspace notification preferences).
- **Rules & edge cases:**
  1. `template_name` required, string, max 191. No uniqueness check; duplicate names are allowed.
  2. `template_type` optional, one of standard, carousel, media, auth; stored default standard.
  3. `category` required, any value. Accepts Meta numeric id 1/2/3, a Meta slug (marketing, authentication, utility; case-insensitive, trimmed) or one of seven industry buckets (travel, healthcare, education, ecommerce, festival, finance, utility).
  4. Stored `category` is the industry bucket if the input equals one, else `utility`. Stored meta category is derived only from numeric 1/2/3 or a slug, otherwise null. QUIRK: input `1` returns `category: "utility"` in the response; the Meta category is not exposed in v1.
  5. `template_body` is a string up to 4096 chars and is required only when `template_type` is literally `standard`. QUIRK: if `template_type` is omitted the server defaults to standard but the body is NOT required and is stored as an empty string.
  6. `header` and `footer` optional strings up to 255. `language` optional, max 16, default `en_US`.
  7. `buttons` optional: an array of objects (keys read: type, text, value, url_type, country_code; non-object items skipped) or a JSON string that is decoded first. `quick_replies` optional: array of strings or `{text}` objects, each non-blank one appended as a quick-reply button. CTA and quick-reply buttons are combined and hard-capped to the first three; extras are dropped silently.
  8. `carousel_data` optional array (or JSON string); stored only if it decodes to an array.
  9. `code_expiration_minutes` optional integer 1 to 90 (authentication templates); blank stored as null (meaning 10 at send time). Validated only in the inner layer, so an out-of-range value returns 422 `create_failed` with details.
  10. Location header: `latitude` (numeric, -90..90) and `longitude` (numeric, -180..180) must be given together; `location_name` max 191; `location_address` max 255. When valid, stores a location object (coordinates as strings), sets `attachment_type` location and clears any attachment.
  11. A positional variable map is derived from `{var}` or `{{var}}` tokens in header and body: unique names, numbered from 1 separately for header and body, stored only when tokens exist.
  12. Other request keys (attachment type, header location object, files) are not forwarded and are ignored.
  13. QUIRK: no Meta submission, no approval polling. The template is immediately approved locally with no Meta id. On a WABA workspace it cannot actually be sent (Meta reports it does not exist) and is hidden from the list (WD-API-030). Meta submission and status sync belong to the dashboard path (WD-TPL-025/026/028).
- **Async & events:** none queued. One in-app notification row (created event). No outbound webhook, no Meta call.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given valid name, category 3 and a body, when POST, then 201, `data.status` is `approved`, `data.category` is `utility`, and the row exists in the workspace.
  - Given `template_type` standard and no body, then 422 for `template_body`; given `template_type` omitted and no body, then 201 with an empty body (QUIRK).
  - Given four buttons plus two quick replies, then the stored template has exactly three buttons, in order.
  - Given `latitude` without `longitude`, then 422; given both valid, then `data.header_location` holds both as strings and `data.attachment_type` is `location`.
  - Given `code_expiration_minutes` 120, then 422 `create_failed` with details naming that field.
  - Given a body with `{{name}}` and `{{city}}`, then the stored variable map lists name as 1 and city as 2 (verifiable through the dashboard/DB, not the v1 response).
- **Source refs:** app/Http/Controllers/Api/V1/TemplateController.php, app/Http/Requests/Api/V1/Template/StoreTemplateRequest.php, app/Http/Controllers/Api/App/TemplateController.php, app/Models/WaTemplate.php, app/Models/Concerns/LogsNotifications.php, app/Helpers/NotificationHelper.php
- **Port notes:** `TemplatesService.create(input)` exists; with `submit=false` it works for an api-key actor, but `submit=true` calls `requireSubmitRight()` which reads `ctx.grants` and would throw for an api key (never set by `ApiKeyGuard`). Decide: keep WaDesk behavior (draft only, but do NOT mark approved) or add a grants-free submit path. The target models approval through Meta, so "approved without Meta id" must not be reproduced as-is; record as an intended difference. Contracts: `createTemplateInputSchema`. Emit audit + outbox in the same transaction. Notification-on-write is covered by the notifications domain (WD-NOTIF), not this endpoint.

### WD-API-033 — GET /templates/{id}: template detail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-API-030
- **Summary:** Returns one template in the public shape, regardless of approval state.
- **Actors & access:** any valid API key; same visibility set as the list but without the sendable and live-number filters.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                | Route name            | Controller@action              | Middleware                             | Request | Response                                |
| ------------------------- | --------------------- | ------------------------------ | -------------------------------------- | ------- | --------------------------------------- |
| GET api/v1/templates/{id} | api.v1.templates.show | Api\V1\TemplateController@show | api, auth.apikey, auth.apikey.throttle | path id | 200 `{data: template}`; 404 `not_found` |

- **Data:** reads `wa_templates`; shape as WD-API-030.
- **Rules & edge cases:**
  1. Pending, rejected, paused and disconnected-number templates are returned (unlike the list).
  2. Not found or outside the visible set returns 404 `not_found`; the message text comes from the inner layer ("not found or unauthorized").
  3. QUIRK: admin-seeded global templates are visible, and equally updatable and deletable (WD-API-034/035) by any workspace.
  4. `buttons` is `[]` and `carousel_data` is `[]` when empty (inner payload normalizes null to empty).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an own template, when GET by id, then 200 with the public shape.
  - Given another workspace's template id, then 404 `not_found`.
  - Given a rejected template in the workspace, then 200 (not hidden).
  - Given a non-numeric id, then 404 from routing.
- **Source refs:** app/Http/Controllers/Api/V1/TemplateController.php, app/Http/Controllers/Api/App/TemplateController.php, app/Http/Resources/Api/V1/TemplateResource.php
- **Port notes:** `TemplatesService.get(uuid)`; path param becomes uuid. RLS handles tenant scoping; return 404 (not 403) for a foreign id. Contract `templateDetailSchema` exists; the public shape should be a separate mapped schema.

### WD-API-034 — PUT /templates/{id}: update a template

- **Status:** partial (partial updates overwrite omitted fields; no Meta resubmission)
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-032, WD-TPL-019
- **Summary:** Replaces a template's editable content. The call behaves as a full replacement for text fields even though it is a PUT with optional fields.
- **Actors & access:** any valid API key; no gates.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                | Route name              | Controller@action                | Middleware                             | Request                                     | Response                                                                  |
| ------------------------- | ----------------------- | -------------------------------- | -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| PUT api/v1/templates/{id} | api.v1.templates.update | Api\V1\TemplateController@update | api, auth.apikey, auth.apikey.throttle | same fields as create; body always required | 200 `{data: template}`; 404 `not_found`; 422 validation / `update_failed` |

- **Data:** updates `wa_templates` (same encrypted columns as create); writes a `notifications` row (updated event). Does not change `status`, `meta_status`, Meta template id or approval time.
- **Rules & edge cases:**
  1. Validation is the create ruleset except `template_body` is always required (string, max 4096); `template_name` and `category` stay required. Validation runs before the existence check: unknown id with an invalid body returns 422, not 404.
  2. QUIRK: `template_name`, `header`, `footer`, `template_body`, `code_expiration_minutes` and the category fields are always overwritten from the request. Omitting `header`, `footer` or `code_expiration_minutes` sets them to null. Only `template_type` and `language` fall back to existing values when omitted.
  3. Buttons are replaced only if the request contains `buttons` or `quick_replies`; an empty result then clears them to null. Same cap of three.
  4. Location is touched only when `latitude` or `longitude` is present; valid coordinates set the location and attachment type; empty or invalid coordinates clear the location without changing the attachment type.
  5. `carousel_data` is replaced only when present and an array. The variable map is recomputed from the new header and body each time (null if no tokens).
  6. QUIRK: editing an approved template body does not resubmit to Meta or change its approval state, so local content can drift from what Meta approved.
  7. Inner not-found is mapped to 404 `not_found`. QUIRK: any other inner failure without an error map (a 500 inside) is also mapped to 404 `not_found` with that message, which is misleading.
  8. Inner validation failure (for example `code_expiration_minutes` out of range) returns 422 `update_failed` with details.
- **Async & events:** one in-app notification row. No webhook, no Meta call.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an own template with a footer, when PUT with name, category and body but no footer, then 200 and the footer is now null.
  - Given a PUT without `buttons`/`quick_replies`, then existing buttons are unchanged; given `buttons: []`, then buttons are cleared.
  - Given an unknown id with a valid body, then 404 `not_found`; with an empty body, then 422.
  - Given another workspace's template, then 404 and the row is unchanged.
  - Given an approved template, when updated, then `status` is still approved.
- **Source refs:** app/Http/Controllers/Api/V1/TemplateController.php, app/Http/Requests/Api/V1/Template/UpdateTemplateRequest.php, app/Http/Controllers/Api/App/TemplateController.php
- **Port notes:** target `TemplatesService.update` uses optimistic locking (`rowVersion` required); a PUT contract needs a decision on how API clients pass or bypass it (suggest PATCH semantics with optional `rowVersion`). Edit-after-approval should trigger the target's own re-review rules rather than copy the no-resubmit drift. `update` with submit needs grants (api-key gap, see WD-API-032).

### WD-API-035 — DELETE /templates/{id}: delete a template

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-033, WD-TPL-020, WD-TPL-050
- **Summary:** Permanently removes a template and its stored header and carousel images. The Meta-side template is not touched.
- **Actors & access:** any valid API key; no gates.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                   | Route name               | Controller@action                 | Middleware                             | Request | Response                                                                             |
| ---------------------------- | ------------------------ | --------------------------------- | -------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| DELETE api/v1/templates/{id} | api.v1.templates.destroy | Api\V1\TemplateController@destroy | api, auth.apikey, auth.apikey.throttle | path id | 200 `{data:{deleted:true,message:"Template deleted successfully"}}`; 404 `not_found` |

- **Data:** hard-deletes the `wa_templates` row (no soft delete); best-effort deletes the stored attachment file and every carousel card image from media storage; writes a `notifications` row (deleted event).
- **Rules & edge cases:**
  1. Unknown or foreign id returns 404 `not_found` (inner message "No matching templates found.").
  2. QUIRK: no Meta delete call, so a template that exists on Meta stays there.
  3. No check for references from broadcasts, campaigns, scheduled messages or auto-reply contents; the controller does not guard it.
  4. Admin-seeded global templates can be deleted by any workspace (shares the visibility set).
  5. File cleanup failures are swallowed; the delete still succeeds.
- **Async & events:** one in-app notification row.
- **External systems:** none (media storage disk).
- **Settings:** none.
- **Acceptance criteria:**
  - Given an own template, when DELETE, then 200 with `deleted:true` and a following GET returns 404.
  - Given a foreign template id, then 404 and the row remains.
  - Given a template with a stored attachment, when deleted, then the file is removed from storage.
  - Given a deleted template referenced by an auto-reply content row, then the delete still succeeds (no guard).
- **Source refs:** app/Http/Controllers/Api/V1/TemplateController.php, app/Http/Controllers/Api/App/TemplateController.php, app/Models/WaTemplate.php
- **Port notes:** target `TemplatesService.remove` exists; check its own in-use rules (broadcasts/campaigns) and whether it calls Meta (decide parity vs safer behavior, record as intended difference). Audit + outbox in the same transaction.

### WD-API-036 — POST /templates/{id}/send: send a template to one number

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-TPL-033, WD-TPL-034, WD-TPL-042, WD-CON-055, WD-TIB1-044
- **Summary:** Sends one approved WABA template to a single phone number with the caller's own variable values (body, text header, media header, dynamic button values), records the recipient as a contact, and mirrors the send into the team inbox.
- **Actors & access:** any valid API key; WABA (Cloud API) provider only. No plan gate and no wallet check on this path.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                      | Route name            | Controller@action              | Middleware                             | Request                                                                                  | Response                                                                                                         |
| ------------------------------- | --------------------- | ------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| POST api/v1/templates/{id}/send | api.v1.templates.send | Api\V1\TemplateController@send | api, auth.apikey, auth.apikey.throttle | to, body, header_text, header_media_url, header_media (file), header_filename, buttons[] | 201 `{data:{wamid,status:"sent",template_id,template_name,to}}`; 404 `template_not_found`; 422 sender/Meta codes |

- **Data:** reads `wa_templates`, `wa_provider_configs` (credentials: access token, phone number id), `system_settings` (Graph API version, daily cap), `webhooks`. Writes `contacts` (auto-capture), `conversations` and `inbox_messages` (mirror), cache counter for the per-template daily cap, and `wa_templates.language` (self-heal only). Response `to` is digits only.
- **Rules & edge cases:**
  1. Validation: `to` required string max 32 (digits or +E.164; non-digits are stripped before the send). `body` optional: either a list or a 1-indexed map (map is sorted numerically and re-indexed to a positional list); each value must be a string up to 1024 chars. QUIRK: JSON numbers or booleans in `body` fail the string rule, so values must be sent as strings.
  2. `header_text` optional string max 1024; `header_media_url` optional valid URL max 2048; `header_media` optional file up to 16384 KB (see WD-API-037); `header_filename` optional string max 255. `buttons` optional list of objects with `index` (integer >= 0, default 0), `sub_type` (string max 32, default url) and `value` (string max 2048, default empty).
  3. Order of work: validate; process the inline file (WD-API-037); look up the template in the workspace visibility set (404 `template_not_found`, message "Template not found in this workspace."); build the variable set (only non-empty parts are included); call the sender.
  4. Sender gates, evaluated in order: Meta status must be APPROVED (`not_approved`); not paused (`paused`); quality score RED blocks (`quality_floor`), while unknown, yellow and green are allowed; per-template daily cap from the system setting `waba_template_daily_cap` when greater than zero (`rate_limited`, counter in cache, 24 h window); provider config must be a WABA config with token and phone number id (`no_provider`); media-header templates need a resolvable media reference (`missing_header_media`); Meta HTTP failure (`meta_error`, message is Meta's described error). Failures return HTTP 422 with the code above and `details:{template_id}`.
  5. Link tracking: when enabled, a full-URL value in a url-type button is replaced with a tracked short link.
  6. Media header handling: a media-header template with no supplied media uses Meta's stored sample, uploaded to Meta and cached as a media id per template and phone; a supplied URL is also uploaded once and its id used, falling back to sending the link if the upload fails. A location header uses the stored coordinates.
  7. Meta error 132001 (template not found in language) triggers one retry with the base language code (en_US becomes en); on success the template's stored language is permanently corrected.
  8. QUIRK: the recipient is auto-captured as a contact AFTER the send attempt and BEFORE the success check, so failed sends still create a contact (dedupe by phone hash; numbers under 6 digits are ignored; never throws).
  9. On success a team-inbox mirror is attempted: it finds the open conversation for the number and sender, or creates one (`allow_create`), and appends an outbound message whose text is header, body and footer joined by blank lines, with numeric `{{n}}` placeholders replaced by the supplied body values; fallback text `[template] <name>`. De-duplicated on the message id. Mirror failure is logged and swallowed; the response is still 201.
  10. QUIRK: only numeric placeholders are substituted in the inbox bubble; named placeholders and header placeholders stay as stored.
  11. The sender number cannot be chosen: the template's own provider config, else the workspace's primary.
  12. No opt-in, unsubscribe or 24-hour-window check (template sends are business-initiated).
- **Async & events:** synchronous Graph API call (20 s timeout). Outbound webhook event `message_sent` (workspace, template id and name, recipient, message id, status sent, timestamp, quality at send) delivered to active workspace webhooks. Later delivered, read and failed events come from the WABA status webhook handler (WD-WABA domain).
- **External systems:** Meta Graph API (version from setting, default v23.0), `POST /{phone-number-id}/messages` with bearer token from the provider config (encrypted credentials), and `/media` upload for header media.
- **Settings:** `waba_template_daily_cap` (0 = off), `waba_graph_api_version`, link-tracking enable flag.
- **Acceptance criteria:**
  - Given an approved WABA template with two body variables, when POST with `to` and `body:["John","123"]`, then 201 with a message id and `status:"sent"`, and the recipient exists as a contact.
  - Given `body:{"2":"B","1":"A"}`, then the variables are sent in order A then B.
  - Given a template with Meta status PENDING, then 422 `not_approved` and no Graph call.
  - Given a quality score RED, then 422 `quality_floor`; given UNKNOWN, then the send proceeds.
  - Given an unknown template id, then 404 `template_not_found`.
  - Given Meta rejects the send, then 422 `meta_error` with Meta's message, AND the recipient contact has still been created.
  - Given a successful send, then an outbound `message_sent` webhook is queued for active workspace webhooks and the inbox thread shows the filled text.
  - Given `body:[123]`, then 422 validation error (strings only).
- **Source refs:** app/Http/Controllers/Api/V1/TemplateController.php, app/Services/Waba/TemplateSender.php, app/Services/Waba/TemplatePayloadBuilder.php, app/Models/Contact.php, app/Services/Inbox/InboxMirror.php, app/Services/WebhookService.php
- **Port notes:** no public single-template-send exists in the target. Build it on `CONVERSATIONS_FACADE.enqueueOutbound` (chat-conversations barrel; `sendMessageSchema` has a template kind) with `sender` set to a bot or new api kind, since `OutboundService` defaults to an agent sender and writes `ctx.userId` (null for keys). Use `ContactResolverService`/`ContactsService.create` (grants-free) for the recipient capture and `ChannelsFacade.list` + `openConversationFor` for the thread; the inbox services (`InboxThreadService`) are user-bound and unusable. Send must go through the worker (BullMQ) and provider adapter, not an inline Graph call, so the synchronous 201-with-message-id contract changes: decide between 202 with a client message id and a short wait. Worker handles emergency halt, plan monthly message limit and wallet; record these as intended additions. Webhook emit via outbox (`message_sent`); customer-webhook CRUD and deliverer do not exist yet (tables `webhooks`, `webhook_deliveries` only). Do not create the contact on failure (intended difference from the QUIRK).

### WD-API-037 — Template send: inline header media upload and secure-upload guard

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-036, WD-TPL-035
- **Summary:** A client can attach the header file (PDF, image, video) in the same multipart request as the template send. The file passes a shared security guard, is stored on the media disk and used as the media header.
- **Actors & access:** same as WD-API-036.
- **UX & screens:** none.
- **Endpoints:** part of `POST api/v1/templates/{id}/send` with `multipart/form-data` and the `header_media` file field (see WD-API-036 table).
- **Data:** writes a file under the `chat-media/` folder of the configured media disk; sets the header media URL and, when none is supplied, the document display filename to the file's original name.
- **Rules & edge cases:**
  1. Size limit 16384 KB (16 MB) from validation; larger files give a Laravel 422.
  2. Guard accepts only extensions from this allowlist: jpg, jpeg, png, gif, webp, bmp, tiff; mp4, webm, mov, 3gp, mkv; pdf, doc, docx, xls, xlsx, ppt, pptx; txt, csv, rtf, zip; mp3, ogg, opus, m4a, aac, wav, amr. An explicit blocklist (php family, html, htm, svg, xml, js, mjs, scripts, executables) is always rejected.
  3. The real content-sniffed MIME (not the client header) must be in an allowed list that includes a generic octet-stream fallback for audio and office files.
  4. Rejections return 422 `unsupported_media_type` with one of: invalid upload, file type not allowed, file content not allowed.
  5. The stored name is `<unix time>_<24 random chars>.<allowlisted extension>`; the client name is never used on disk.
  6. An inline file overrides a supplied `header_media_url`. A caller-supplied `header_filename` wins over the original name.
  7. QUIRK: the file is stored before the template lookup, so a 404 `template_not_found` leaves an orphan file.
- **Async & events:** none beyond WD-API-036.
- **External systems:** media storage disk (local or S3-compatible per platform settings).
- **Settings:** media disk and public URL (platform storage settings).
- **Acceptance criteria:**
  - Given a PDF in `header_media`, when sending to a document-header template, then 201 and the message used the stored file's URL with the PDF's original name.
  - Given a `.php` file, then 422 `unsupported_media_type`.
  - Given a `.png` extension whose bytes are an HTML document, then 422 `unsupported_media_type` (content check).
  - Given both `header_media` and `header_media_url`, then the uploaded file is used.
  - Given an unknown template id with a valid file, then 404 (and a stored orphan file is acceptable parity, not required).
- **Source refs:** app/Support/SecureUpload.php, app/Http/Controllers/Api/V1/TemplateController.php
- **Port notes:** target has an inbox upload and media claim path (`sendMessageSchema` media kind takes a `mediaId` from the inbox upload), and `uploadMedia` in `TemplatesService` needs grants. Reuse the platform upload/scan service; implement the same allowlist and sniffing; avoid orphan files by validating the template first. Shared with the media endpoint of the API domain.

### WD-API-038 — GET /auto-replies: list rules

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-AR-001
- **Summary:** Lists all keyword auto-reply rules of the workspace, newest first, with the selected reply variants of each rule.
- **Actors & access:** any valid API key; no plan gate, rule cap or role check on this path.
- **UX & screens:** none.
- **Endpoints:**

| Method uri              | Route name                | Controller@action                | Middleware                             | Request | Response                                                   |
| ----------------------- | ------------------------- | -------------------------------- | -------------------------------------- | ------- | ---------------------------------------------------------- |
| GET api/v1/auto-replies | api.v1.auto-replies.index | Api\V1\AutoReplyController@index | api, auth.apikey, auth.apikey.throttle | none    | 200 `{data:[auto-reply], meta:{count}}`; 422 `list_failed` |

- **Data:** reads `keyword_replies` (soft-deleted rows excluded), `keyword_reply_contents`, `flows` (per-row lookup, unused in output), and connected senders for labels. Ordered by creation time descending, unbounded. Public shape: `id`, `keyword`, `matching_method`, `fuzzy_similarity` (int), `device_id` (a LABEL, see rule 2), `reply_type`, `flow_id`, `message_type` (text, image, video, document, template or null), `status` (boolean), `replies` (each: `id`, `type`, `content`, `url`, `template_id`, `original_name`, `is_selected`), `created_at`, `updated_at` (raw datetime serialization, ISO-8601 with microseconds).
- **Rules & edge cases:**
  1. Scoping is workspace-wide; the mobile app's selected-sender filter does not apply to API keys.
  2. QUIRK: `device_id` in the response is a human label (the sender's name or phone, "All <channel> numbers" when the rule has no sender, or "Disconnected or removed number"); the numeric id is dropped by the v1 resource, so a client cannot round-trip the value reliably.
  3. In the list, `replies` contains only the selected variants (ordered by sort order); the detail endpoint returns all variants. QUIRK:
  4. `fuzzy_similarity` is returned (default 80) even for non-fuzzy rules.
  5. Not exposed: provider/engine, sender key, cooldown, timeout, trigger counts, catch-all, welcome/away triggers, working hours, priority.
  6. Empty workspace returns `data: []`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three rules, when GET, then 200 with three items newest first and `meta.count` 3.
  - Given a rule with two variants where one is unselected, then the list shows one reply and the detail shows two.
  - Given a rule whose sender was deleted, then `device_id` reads "Disconnected or removed number".
  - Given a soft-deleted rule, then it is absent.
  - Given another workspace's rules, then none are returned.
- **Source refs:** app/Http/Controllers/Api/V1/AutoReplyController.php, app/Http/Controllers/Api/App/AutoreplyController.php, app/Http/Resources/Api/V1/AutoReplyResource.php, app/Models/KeywordReply.php, app/Models/KeywordReplyContent.php
- **Port notes:** target has schema only (`auto_reply_lookups`, `keyword_replies`, `keyword_reply_contents`, `keyword_reply_logs` in `packages/db/src/schema/auto-reply-keywords`); no module, contracts or permission keys. Prerequisite: the auto-reply-keywords domain service (WD-AR-010/012). The public API should return both the sender id (uuid) and the label rather than the label alone (recorded as an intended difference). Add pagination (WaDesk has none).

### WD-API-039 — POST /auto-replies: create a keyword rule

- **Status:** partial (shipped create path cannot succeed, see WD-API-043; spec below is the intended behavior)
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-043, WD-AR-010, WD-AR-023, WD-AR-024
- **Summary:** Creates a keyword-triggered rule that replies with one or more text variants or starts a saved flow. Only text variants and flow rules are reachable through v1 (no media or template variants).
- **Actors & access:** any valid API key; no plan feature check, no rule cap check (unlike the dashboard, WD-AR-029).
- **UX & screens:** none.
- **Endpoints:**

| Method uri               | Route name                | Controller@action                | Middleware                             | Request                                                                                       | Response                                                      |
| ------------------------ | ------------------------- | -------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| POST api/v1/auto-replies | api.v1.auto-replies.store | Api\V1\AutoReplyController@store | api, auth.apikey, auth.apikey.throttle | keyword, matching_method, fuzzy_similarity, device_id, status, reply_type, flow_id, replies[] | 201 `{data: auto-reply}`; 422 validation; 422 `create_failed` |

- **Data:** intended writes: `keyword_replies` (workspace, creating user = key owner, engine/provider stamped from the workspace's active engine by the model, keyword, matching method, fuzzy similarity, sender id, status, reply type, flow id), `keyword_reply_contents` (one row per text variant: type text, selected flag, sort order starting at 1), then `message_type` set to text when any variant was selected. One database transaction; commit or full rollback.
- **Rules & edge cases:**
  1. `keyword` required string max 255; comma-separated phrases are allowed and stored as given (not trimmed or normalized). No uniqueness check; duplicate keywords are allowed.
  2. `matching_method` optional, one of fuzzy, exact, contains (regex is not accepted here although the model supports it); default exact.
  3. `fuzzy_similarity` optional integer 0 to 100; stored 80 when omitted.
  4. `device_id` required (any type, cast to string). No check that it belongs to the workspace.
  5. `status` optional boolean, default true (active) when omitted.
  6. `reply_type` optional, custom or flow; default custom. `flow_id` required when flow; integer; must exist as a flow in the key's workspace; stored only for flow rules, otherwise null.
  7. `replies` required when custom (the array must be present and non-empty); each item a string up to 4096. Blank or whitespace-only items are dropped and every kept item is marked selected. QUIRK: an array of only blanks passes validation but creates zero variants and leaves `message_type` null.
  8. Media and template variants are not accepted through v1 (the inner layer supports uploads and template ids; the wrapper never forwards them).
  9. QUIRK: validation failures from the form request come back as the plain Laravel 422 shape; failures from the inner layer come back as 422 `create_failed` with details.
  10. The sender (`device_id`) resolution is broken in the shipped code (WD-API-043).
- **Async & events:** none. No webhook, no queue. The runtime that fires rules (bot lookup, dispatcher) is a separate domain (WD-AR-030 onward).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** (_intended behavior; WaDesk shipped build returns 422 `create_failed` for every otherwise-valid request, see WD-API-043_)
  - Given keyword, device id and two replies, when POST, then 201, `data.status` true, `data.matching_method` exact, `data.fuzzy_similarity` 80 and two replies, both selected.
  - Given `reply_type` flow with a flow id from another workspace, then 422 on `flow_id`.
  - Given `reply_type` custom and no replies, then 422 on `replies`.
  - Given `matching_method` regex, then 422.
  - Given any failure after the rule row is created, then no rule or variant rows remain (transaction rollback).
  - Given the shipped WaDesk build, when POST with a valid body, then the observed response is 422 `create_failed` with message "Failed to create autoreply" and no rows are created.
- **Source refs:** app/Http/Controllers/Api/V1/AutoReplyController.php, app/Http/Requests/Api/V1/AutoReply/StoreAutoReplyRequest.php, app/Http/Controllers/Api/App/AutoreplyController.php, app/Models/KeywordReply.php, app/Models/KeywordReplyContent.php
- **Port notes:** target has no auto-reply module; schema tables exist. Build the module first (new-module skill, plus contracts and permission keys), then a public controller. Port the intended behavior, not the defect. Audit + outbox in the same transaction; the flow existence check must use the tenant-scoped flow lookup. Add an idempotency key for API creates (target has `@Idempotent`).

### WD-API-040 — GET /auto-replies/{id}: rule detail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-038
- **Summary:** Returns one rule with all of its reply variants, selected or not.
- **Actors & access:** any valid API key.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                   | Route name               | Controller@action               | Middleware                             | Request | Response                                  |
| ---------------------------- | ------------------------ | ------------------------------- | -------------------------------------- | ------- | ----------------------------------------- |
| GET api/v1/auto-replies/{id} | api.v1.auto-replies.show | Api\V1\AutoReplyController@show | api, auth.apikey, auth.apikey.throttle | path id | 200 `{data: auto-reply}`; 404 `not_found` |

- **Data:** same as WD-API-038; `replies` lists every variant ordered by sort order.
- **Rules & edge cases:**
  1. Lookup is by workspace and id; soft-deleted rules return 404.
  2. Foreign workspace id returns 404 `not_found` (inner message "Autoreply not found").
  3. Output shape and the label-only `device_id` quirk as in WD-API-038.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an own rule, when GET by id, then 200 with all variants including unselected ones.
  - Given another workspace's rule id, then 404 `not_found`.
  - Given a soft-deleted rule id, then 404.
  - Given a rule of reply type flow, then `flow_id` is set and `replies` is empty.
- **Source refs:** app/Http/Controllers/Api/V1/AutoReplyController.php, app/Http/Controllers/Api/App/AutoreplyController.php, app/Http/Resources/Api/V1/AutoReplyResource.php
- **Port notes:** depends on the auto-reply module (see WD-API-038). Return uuids.

### WD-API-041 — PUT /auto-replies/{id}: update a rule

- **Status:** partial (shipped update path cannot succeed once the rule is found, see WD-API-043)
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-039, WD-AR-012
- **Summary:** Updates a rule's settings and appends new text variants. Despite being a PUT, existing variants are never removed or edited.
- **Actors & access:** any valid API key.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                   | Route name                 | Controller@action                 | Middleware                             | Request               | Response                                                                    |
| ---------------------------- | -------------------------- | --------------------------------- | -------------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| PUT api/v1/auto-replies/{id} | api.v1.auto-replies.update | Api\V1\AutoReplyController@update | api, auth.apikey, auth.apikey.throttle | same fields as create | 200 `{data: auto-reply}`; 404 `not_found`; 422 validation / `update_failed` |

- **Data:** intended: updates `keyword_replies` scalars and inserts new `keyword_reply_contents` rows in one transaction.
- **Rules & edge cases:**
  1. Same validation as create; `keyword` and `device_id` are required on every call. Validation runs before the existence check (unknown id with an invalid body returns 422).
  2. Scalar fields are fully replaced; omitted ones take the create defaults again: matching method exact, similarity 80, status true, reply type custom.
  3. QUIRK: existing reply variants are never deleted or edited. Each custom update inserts the supplied replies as new variants after the current highest sort order, so repeating the same PUT multiplies variants. The only way to remove variants is deleting the rule.
  4. Switching to a flow rule sets the flow id and leaves old variants in place (unused); switching to custom clears the flow id.
  5. Not-found is detected by the inner message containing "not found" and mapped to 404 `not_found`; other inner failures become 422 `update_failed` with details.
  6. In the shipped build, after the rule is found, the sender resolution call fails and every request returns 422 `update_failed` ("Failed to update autoreply") with no changes (WD-API-043).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** (_intended_)
  - Given a rule with one variant, when PUT with one new reply, then 200 and the detail shows two variants (append behavior).
  - Given a PUT omitting `status`, then the rule is active afterwards even if it was paused.
  - Given an unknown id with a valid body, then 404 `not_found`.
  - Given a PUT that fails midway, then no partial change remains.
  - Given the shipped WaDesk build and an existing rule, then the observed response is 422 `update_failed`.
- **Source refs:** app/Http/Controllers/Api/V1/AutoReplyController.php, app/Http/Requests/Api/V1/AutoReply/UpdateAutoReplyRequest.php, app/Http/Controllers/Api/App/AutoreplyController.php
- **Port notes:** build as part of the auto-reply module. Decide explicitly whether the port keeps append semantics (parity) or true replace; recommend replace-with-optional-variant-ids as an intended difference and record it. Use optimistic locking (`rowVersion`) in the target.

### WD-API-042 — DELETE /auto-replies/{id}: delete a rule

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-040, WD-AR-006, WD-AR-042
- **Summary:** Deletes a rule and its reply variants and uploaded files.
- **Actors & access:** any valid API key.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                      | Route name                  | Controller@action                  | Middleware                             | Request | Response                                        |
| ------------------------------- | --------------------------- | ---------------------------------- | -------------------------------------- | ------- | ----------------------------------------------- |
| DELETE api/v1/auto-replies/{id} | api.v1.auto-replies.destroy | Api\V1\AutoReplyController@destroy | api, auth.apikey, auth.apikey.throttle | path id | 200 `{data:{id,deleted:true}}`; 404 `not_found` |

- **Data:** in one transaction: deletes stored files of variants that have a file path from the public directory, hard-deletes all `keyword_reply_contents` rows, and soft-deletes the `keyword_replies` row (deleted-at set; row stays).
- **Rules & edge cases:**
  1. Unknown, foreign or already-deleted id returns 404 `not_found`. Inner failures are also mapped to 404.
  2. QUIRK: soft delete leaves the rule row in the table; variants are gone.
  3. QUIRK: no check that the rule is flow-managed (created by a flow's keyword trigger); a deleted managed rule is recreated the next time its flow is saved (WD-AR-042).
  4. Response echoes the numeric id from the path.
- **Async & events:** none.
- **External systems:** local file system for variant files.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an own rule with an image variant, when DELETE, then 200, the file is gone and a following GET returns 404.
  - Given another workspace's rule, then 404 and nothing changes.
  - Given a deleted rule, then it no longer appears in the list.
  - Given a second DELETE of the same id, then 404.
- **Source refs:** app/Http/Controllers/Api/V1/AutoReplyController.php, app/Http/Controllers/Api/App/AutoreplyController.php, app/Models/KeywordReply.php
- **Port notes:** target `keyword_replies` follows the hard-delete convention of this repo (decide soft vs hard, the inventory says hard delete is the norm); delete media via the storage service; audit + outbox. Exclude or flag flow-managed rules.

### WD-API-043 — Auto-reply sender (device_id) resolution: helper missing in shipped code

- **Status:** dead-code
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-AR-011
- **Summary:** Both the create and update paths of the underlying auto-reply controller call a helper that turns the incoming `device_id` (either a numeric sender id or the sender's display name echoed back from a list response) into the stored sender id. That helper is not defined anywhere in the shipped code, so those paths cannot complete.
- **Actors & access:** affects `POST /auto-replies` and `PUT /auto-replies/{id}` (WD-API-039, WD-API-041) and, equally, the mobile app endpoints that share the controller.
- **UX & screens:** none.
- **Endpoints:** none of its own.
- **Data:** none written (the transaction rolls back).
- **Rules & edge cases:**
  1. Verified fact: a recursive search of the whole `wadesk-reference/` tree for the helper name `normalizeDeviceIdInput` finds only two call sites and one comment, all in `app/Http/Controllers/Api/App/AutoreplyController.php`. It is not defined in that class, in the `ScopesToSelectedSender` trait, in the base controller (no `__call`), in any model, service, helper or other file.
  2. Observed consequence: for a valid create, evaluating the row payload throws; the transaction rolls back and the inner response is a 500 "Failed to create autoreply". The v1 wrapper maps any non-success inner result to 422 `create_failed` carrying that message and no details.
  3. For update: validation and the rule lookup run first, so an unknown id still returns 404 `not_found`; for an existing rule the same throw yields 422 `update_failed` ("Failed to update autoreply").
  4. Intent documented by a comment in the list serializer: the list/detail `device_id` is swapped to the sender's display NAME, and the write side is supposed to resolve a name back to the id, so a client that echoes the value it read still saves against the right account. A numeric id must also be accepted.
  5. Related unchecked gap: even in the intended design, no check proves the resolved sender belongs to the workspace.
  6. Status: treat the sender-resolution rule above as the intended contract; the shipped failure is a defect to record, not behavior to port.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the shipped WaDesk reference, when POST /auto-replies with a fully valid body, then the response is HTTP 422 with code `create_failed` and no rows are created.
  - Given the shipped reference, when PUT on an existing rule with a valid body, then 422 `update_failed`; on an unknown id, then 404 `not_found`.
  - Given the port, when `device_id` is a numeric sender id of the workspace, then the rule is saved against it.
  - Given the port, when `device_id` is the display name returned by a prior list call, then it resolves to the same sender; when it names no sender of the workspace, then 422 on `device_id`.
- **Source refs:** app/Http/Controllers/Api/App/AutoreplyController.php (lines near the store and update payloads, and the sender label helper), app/Http/Controllers/Api/App/Concerns/ScopesToSelectedSender.php, app/Http/Controllers/Controller.php
- **Port notes:** implement sender resolution inside the auto-reply service: accept a sender uuid (target uses `<engine>:<uuid>` sender keys via `SENDER_DIRECTORY`); optionally accept a label for compatibility. Validate workspace ownership under RLS. Confirm with the product owner that the broken state is not a feature; raise it in the parity report as "WaDesk defect, intended: works".

### WD-API-044 — GET /flows: list flows

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-FLR-001
- **Summary:** Lists the workspace's chatbot flows with derived status and subscriber counts, most recently updated first. Route ownership is the API domain; behavior is also recorded in WD-FLR-009.
- **Actors & access:** any valid API key; no plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri       | Route name         | Controller@action           | Middleware                             | Request | Response                          |
| ---------------- | ------------------ | --------------------------- | -------------------------------------- | ------- | --------------------------------- |
| GET api/v1/flows | api.v1.flows.index | Api\V1\FlowController@index | api, auth.apikey, auth.apikey.throttle | none    | 200 `{data:[flow], meta:{count}}` |

- **Data:** reads `flows` (workspace-owned rows, plus legacy rows with no workspace owned by the key's user) and counts `flow_subscribers` per flow. Shape: `id`, `name` (decrypted flow name), `trigger` (the trigger kind, may be null), `status` derived (not published is draft; published and active is live; published and inactive is paused), `category` (or null), `subscribers_count` (all statuses), `created_at`, `updated_at` (ISO-8601). Ordered by last update descending; no pagination.
- **Rules & edge cases:**
  1. Drafts, paused flows and flows of every type (WhatsApp, Instagram, Facebook, others) are all listed; the shape has no flow type or provider field. QUIRK:
  2. Flow definition, trigger value, keywords and trigger device are not exposed.
  3. Empty workspace returns an empty list with count 0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a live, a paused and a draft flow, when GET, then 200 with statuses live, paused and draft, ordered by last update.
  - Given a flow with five subscribers of mixed status, then `subscribers_count` is 5.
  - Given another workspace's flows, then none are returned.
  - Given no flows, then `data` is empty and `meta.count` is 0.
- **Source refs:** app/Http/Controllers/Api/V1/FlowController.php, app/Http/Resources/Api/V1/FlowResource.php, app/Models/Flow.php
- **Port notes:** exists in the target as `GET public/v1/flows` (`flow-runtime-engine/flow-runtime-public.controller.ts`, `FlowRuntimeService.listFlows`). Gaps: no `@RequirePlanFeature('public_api')` on that controller, no e2e coverage. Verify the response mapping matches this entry (status derivation, counts).

### WD-API-045 — GET /flows/{id}: flow detail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-044
- **Summary:** Returns a single flow in the same shape as the list.
- **Actors & access:** any valid API key.
- **UX & screens:** none.
- **Endpoints:**

| Method uri            | Route name        | Controller@action          | Middleware                             | Request | Response                            |
| --------------------- | ----------------- | -------------------------- | -------------------------------------- | ------- | ----------------------------------- |
| GET api/v1/flows/{id} | api.v1.flows.show | Api\V1\FlowController@show | api, auth.apikey, auth.apikey.throttle | path id | 200 `{data: flow}`; 404 `not_found` |

- **Data:** as WD-API-044.
- **Rules & edge cases:**
  1. A flow outside the workspace returns 404 `not_found` with the message "Flow not found."
  2. Status derivation and `subscribers_count` identical to the list.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an own live flow, when GET by id, then 200 with `status` live.
  - Given a draft flow, then `status` draft.
  - Given another workspace's flow id, then 404 `not_found`.
  - Given a non-numeric id, then routing 404.
- **Source refs:** app/Http/Controllers/Api/V1/FlowController.php, app/Http/Resources/Api/V1/FlowResource.php
- **Port notes:** `FlowRuntimeService.getFlow` in the target public controller; uuids in path.

### WD-API-046 — POST /flows/{id}/enroll: enroll a contact by id or phone

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** WD-FLR-009, WD-FLR-011, WD-API-045
- **Summary:** Starts a flow for one contact, identified by contact id or phone number. The call is idempotent per flow and contact and starts the message flow through the Node runtime.
- **Actors & access:** any valid API key; no plan gate and no check of the contact's opt-out state or of the flow's trigger kind (any active flow can be enrolled manually).
- **UX & screens:** none.
- **Endpoints:**

| Method uri                    | Route name          | Controller@action            | Middleware                             | Request                                       | Response                                                                                                                                     |
| ----------------------------- | ------------------- | ---------------------------- | -------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| POST api/v1/flows/{id}/enroll | api.v1.flows.enroll | Api\V1\FlowController@enroll | api, auth.apikey, auth.apikey.throttle | contact_id (integer) or phone (string max 32) | 201 `{data:{flow_id,contact_id,subscriber_id,status,enrolled_at}}`; 404 `not_found`/`contact_not_found`; 422 `flow_inactive`/`enroll_failed` |

- **Data:** reads `flows`, `contacts`, `workspaces`, `devices` or `wa_provider_configs`, `system_settings`; writes `flow_subscribers` (unique per flow and contact; status active, enrolled time now).
- **Rules & edge cases:**
  1. `contact_id` required unless `phone` is given; `phone` required unless `contact_id` is given. When both are present, `contact_id` wins.
  2. Order of checks: flow in workspace (404 `not_found`); flow `is_active` (422 `flow_inactive`, message "Flow is not active."); contact lookup (404 `contact_not_found`). The publish flag is not checked, only the active flag. QUIRK:
  3. Contact by id: restricted to the flow's workspace. Contact by phone: all workspace contacts are loaded and compared in memory; the digits of country code plus mobile must equal the digits of the given phone. QUIRK: contacts whose stored mobile already includes the country code (common) have a doubled prefix and will not match a plain international number; also a performance risk on large workspaces. A contact is never auto-created.
  4. The subscriber row is first-or-created. Only when the row is new OR currently failed is it reset to active (failure fields cleared) and a launch attempted. Enrolling an existing active, paused or completed subscriber is a no-op that still returns 201 with the current status.
  5. Launch is skipped (subscriber stays active, nothing sent) when the workspace has an AI business agent fronting auto-replies (the "suppresses our auto-reply" mode).
  6. Launch resolves the sender by engine: Baileys uses the flow's trigger device if active and in the workspace, else the first connected active device, else the first active device; WABA and Twilio use the workspace's connected provider config (primary first). No sender marks the subscriber failed ("No connected <engine> sender"); a contact with no usable mobile fails ("Contact has no usable mobile number"); a missing Node bridge URL fails.
  7. The recipient phone is the contact's canonical number (country code prefixed only if not already present).
  8. Start is a synchronous HTTP call (15 s timeout) to the Node runtime with flow id, recipient, subscriber id, engine, contact name, first name, email and an empty variables object. A non-success answer or an exception marks the subscriber failed with a short reason (first 150 chars).
  9. QUIRK: a failed launch still returns HTTP 201, with `status:"failed"` and without the reason; the reason is only visible in the subscribers list (WD-API-047).
  10. `enroll_failed` (422) carries the exception text; in practice only "Contact not in flow workspace" and it is unreachable because the lookup is workspace-scoped.
  11. Step execution after the start (delays, branches, completion) runs in the Node runtime and updates the subscriber later.
- **Async & events:** synchronous Node bridge call at enroll time; asynchronous step execution in the runtime (WD-FLR). No webhook event is emitted by the enroll itself.
- **External systems:** Node flow runtime `POST /api/flow/start/{senderPhone}` with the `X-Node-Token` header; Node bridge URL from the `baileys_server_url` setting or `SERVER_URL` env.
- **Settings:** `baileys_server_url` / `SERVER_URL`; workspace AI responder mode (suppression).
- **Acceptance criteria:**
  - Given an active flow and an existing contact, when POST with `contact_id`, then 201 with a subscriber id and `status` active (or failed if no sender, see rule 9).
  - Given a contact whose stored mobile matches the digits, when POST with `phone`, then 201; given no match, then 404 `contact_not_found`.
  - Given a paused flow (`is_active` false), then 422 `flow_inactive`; given a draft but active flow, then enrollment proceeds.
  - Given the same contact enrolled twice, then the second call returns 201 with the same subscriber id and no second launch.
  - Given neither `contact_id` nor `phone`, then 422 validation.
  - Given a workspace with no connected sender, then 201 with `status:"failed"` and the subscribers list shows the failure reason.
  - Given another workspace's flow id, then 404 `not_found`.
- **Source refs:** app/Http/Controllers/Api/V1/FlowController.php, app/Http/Requests/Api/V1/Flow/EnrollFlowRequest.php, app/Services/Flow/FlowEnrollmentService.php, app/Models/FlowSubscriber.php
- **Port notes:** target `POST public/v1/flows/:id/enroll` (201) exists (`FlowRuntimeService.enrollOne`, body `enrollOneInputSchema`: contact uuid or phone; errors FLR_CONTACT_NOT_FOUND, FLR_FLOW_INACTIVE). Gaps: add `@RequirePlanFeature('public_api')`; replace the in-memory phone scan with an indexed phone lookup (use the normalized phone; do not copy the doubled-prefix mismatch); launch through the worker queue rather than an inline HTTP call; return the failure reason in the response. Check the launch hand-off against WD-FLR-011.

### WD-API-047 — GET /flows/{id}/subscribers: subscriber list and counts

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-FLR-009, WD-FLR-051, WD-FLR-052
- **Summary:** Lists a flow's subscribers (newest first) with each one's state, and status counts for the returned slice.
- **Actors & access:** any valid API key.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                        | Route name               | Controller@action                 | Middleware                             | Request       | Response                                                                                          |
| --------------------------------- | ------------------------ | --------------------------------- | -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| GET api/v1/flows/{id}/subscribers | api.v1.flows.subscribers | Api\V1\FlowController@subscribers | api, auth.apikey, auth.apikey.throttle | limit (query) | 200 `{data:[subscriber], meta:{count, counts:{active,paused,completed,failed}}}`; 404 `not_found` |

- **Data:** reads `flows`, `flow_subscribers` (ordered by id descending), `contacts` (id, first name, last name, country code, mobile). Item: `id`, `contact_id`, `contact_name`, `contact_phone`, `status` (active, paused, completed, failed), `enrolled_at`, `failed_at` (ISO-8601 or null), `failure_reason`.
- **Rules & edge cases:**
  1. `limit` default 100, clamped to 1..200 (500 becomes 200; non-numeric becomes 1).
  2. No page, offset or cursor, so only the newest `limit` subscribers are reachable. QUIRK:
  3. QUIRK: `meta.counts` are tallied over the returned slice only, not the true totals.
  4. `contact_name` is first name plus last name trimmed; fallback is `#<contact id>`. QUIRK: the contact's single `name` field is ignored, so contacts that only have `name` show as `#id`.
  5. `contact_phone` is the digits of country code plus mobile (doubled prefix possible), or empty string.
  6. `completed_at` is not returned.
  7. Another workspace's flow returns 404 `not_found`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 250 subscribers and `limit=500`, when GET, then exactly 200 items newest first and `meta.count` 200.
  - Given a failed subscriber, then the item has `status` failed, `failed_at` and `failure_reason` set.
  - Given a contact with first and last name, then `contact_name` is the joined name; given none, then `#<id>`.
  - Given another workspace's flow, then 404 `not_found`.
  - Given `limit=0`, then one item is returned.
- **Source refs:** app/Http/Controllers/Api/V1/FlowController.php, app/Models/FlowSubscriber.php
- **Port notes:** target `GET public/v1/flows/:id/subscribers` (`FlowRuntimeService.subscribersOf`, `listFlowSubscribersQuerySchema`) exists. Recommended fixes recorded as intended differences: cursor pagination, counts over the full set, use the contact's display name. Same plan-feature gap as WD-API-044.

### WD-API-048 — GET /deals: paginated list with filters

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-053, WD-DEAL-030
- **Summary:** Lists the workspace's deals, newest first, with optional pipeline, stage and status filters and page-number pagination.
- **Actors & access:** any valid API key whose workspace plan has the sales pipeline feature, or whose key owner is an admin (WD-API-053).
- **UX & screens:** none.
- **Endpoints:**

| Method uri       | Route name         | Controller@action           | Middleware                             | Request                                       | Response                                                                               |
| ---------------- | ------------------ | --------------------------- | -------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET api/v1/deals | api.v1.deals.index | Api\V1\DealController@index | api, auth.apikey, auth.apikey.throttle | per_page, page, pipeline_id, stage_id, status | 200 `{data:[deal], meta:{page,per_page,total,last_page}}`; 403 `plan_feature_disabled` |

- **Data:** reads `deals` (workspace), `pipeline_stages` (stage name). Deal shape: `id`, `title`, `pipeline_id`, `stage_id`, `stage` (name or null), `status` (open, won, lost), `value` (major units, `value_minor` / 100), `value_minor` (integer), `currency`, `contact_id`, `owner_user_id`, `source` (manual, inbox, order, shopify, woo, form, api, flow, facebook), `expected_close_date` (Y-m-d or null), `lost_reason`, `won_at`, `lost_at`, `created_at`, `updated_at` (ISO-8601 or null). Ordered by id descending.
- **Rules & edge cases:**
  1. `per_page` default 25, clamped 1..100. `page` is the standard page number, default 1 (offset pagination, not cursor).
  2. `pipeline_id` and `stage_id` filter only when non-empty (integers). `status` filters when non-empty and is not validated; an unknown value returns an empty list, not an error.
  3. No search, contact, owner or date filters.
  4. `value` is an integer when divisible by 100 minor units, otherwise a decimal.
  5. The plan gate runs first, before any query.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan feature `access_sales_pipeline`.
- **Acceptance criteria:**
  - Given 30 deals and no params, then 25 items, `meta.total` 30, `meta.last_page` 2.
  - Given `per_page=500`, then at most 100 items and `meta.per_page` 100.
  - Given `stage_id` of a stage, then only deals in that stage; given `status=won`, only won deals.
  - Given `status=bogus`, then 200 with an empty list.
  - Given a plan without the sales pipeline, then 403 `plan_feature_disabled`.
  - Given another workspace's deals, then none are returned.
- **Source refs:** app/Http/Controllers/Api/V1/DealController.php, app/Models/Deal.php
- **Port notes:** target `DealsService.list(query, scope)` takes an explicit scope; pass `'all'` for api-key actors (the `@GrantedScope` decorator defaults to own without grants, so do not reuse it). Guard with `SalesPipelineGuard` equivalent (feature key `sales_pipeline`; deals-plan `assertEnabled(orgId)`). Contracts `listDealsQuerySchema`, `dealResponseSchema` exist; map to the public shape with uuids and keep WaDesk's `value` (major) plus `value_minor`. Offset pagination vs the target's cursor convention: decide (recorded intended difference).

### WD-API-049 — POST /deals: create a deal

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-053, WD-DEAL-002, WD-DEAL-032
- **Summary:** Creates an opportunity from an integration (CRM, n8n, Zapier). Pipeline, stage and contact are resolved leniently: an unknown reference silently falls back to a default instead of failing.
- **Actors & access:** any valid API key passing the plan gate (WD-API-053).
- **UX & screens:** none.
- **Endpoints:**

| Method uri        | Route name         | Controller@action           | Middleware                             | Request                                                                                       | Response                                                                                       |
| ----------------- | ------------------ | --------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| POST api/v1/deals | api.v1.deals.store | Api\V1\DealController@store | api, auth.apikey, auth.apikey.throttle | title, pipeline_id, stage_id, value, currency, contact_id, owner_user_id, expected_close_date | 201 `{data: deal}` (no meta); 422 validation; 422 `unprocessable`; 403 `plan_feature_disabled` |

- **Data:** writes `deals`; may write `pipelines` and `pipeline_stages` (default seeding) and `inbox_notifications`; reads `contacts`, `workspaces`, `system_settings`, `currencies`.
- **Rules & edge cases:**
  1. `title` required string max 191. `pipeline_id`, `stage_id`, `contact_id`, `owner_user_id` optional integers. `value` optional numeric 0 to 99,999,999 in major units, stored as round(value x 100) minor units, default 0. `currency` optional string max 10, stored as given (no ISO check, no uppercasing); default is the pipeline's currency. `expected_close_date` optional, any parseable date.
  2. Pipeline: used if the id belongs to the workspace; otherwise (omitted, unknown or foreign) the workspace default pipeline is used, seeded on demand (named "Sales Pipeline", workspace currency or platform default or USD, six stages: New Lead 10%, Qualified 25%, Proposal 50%, Negotiation 75%, Won 100% flagged won, Lost 0% flagged lost). QUIRK: an invalid `pipeline_id` does not error.
  3. Stage: used if the id belongs to the chosen pipeline; otherwise the pipeline's first stage by sort order. QUIRK: invalid `stage_id` silently falls back. A pipeline with no stages gives 422 `unprocessable` ("Pipeline has no stages.").
  4. Contact: set only if it exists in the workspace, else silently null.
  5. `owner_user_id` is stored as given with no membership check. QUIRK: any user id (even from another workspace) is accepted and would receive the assignment notification.
  6. `source` is forced to `api`.
  7. When resolving the default pipeline, existing workspace deals and pipelines still carrying the legacy `INR` currency are relabeled to the workspace currency (no value conversion). Side effect even on this create.
  8. Creating straight into a won or lost stage sets status won or lost and the won or lost time immediately.
  9. The deal-created hook sends an owner notification if `owner_user_id` is greater than zero and differs from the key owner (type deal assigned; deduped for 30 s; web push when enabled), and a won/lost notification if created into a terminal stage and the owner is not the actor. All best effort; failures are swallowed.
  10. No `deal_stage_changed` flow trigger and no timeline row on create (those fire on update only, WD-API-054). No outbound webhook.
- **Async & events:** in-app notification rows, optional web push. No queue, no webhook.
- **External systems:** web push (VAPID) when the system setting is on.
- **Settings:** plan feature `access_sales_pipeline`; `default_currency`; `ti_pwa_enabled`.
- **Acceptance criteria:**
  - Given a workspace with no pipeline, when POST with a title, then 201, the default pipeline and six stages are created, `stage` is "New Lead", `status` open, `source` api.
  - Given `value` 12.5, then `value_minor` 1250 and `value` 12.5.
  - Given `pipeline_id` of another workspace, then 201 and the deal sits on the workspace default pipeline.
  - Given `stage_id` of a Won stage, then 201 with `status` won and `won_at` set.
  - Given `contact_id` that does not exist, then 201 with `contact_id` null.
  - Given a missing title, then 422; given `value` -1, then 422.
  - Given a plan without the sales pipeline, then 403 `plan_feature_disabled` and no row is created.
- **Source refs:** app/Http/Controllers/Api/V1/DealController.php, app/Models/Deal.php, app/Models/Pipeline.php, app/Models/PipelineStage.php, app/Services/Inbox/NotificationDispatcher.php
- **Port notes:** target `DealsService.create(input, source)` (usable by api key; `ownerId` falls back to `ctx.userId`, null for keys) and `PipelinesService` (no grants reads) cover it; `createDealSchema` has pipelineId, stageId, value, currency, ownerId, contactId, expectedCloseDate. Check that source value `api` exists in the target enum. Decide whether to keep silent fallbacks (parity) or return 422 for unknown pipeline/stage/contact/owner (recommended; record as intended difference). Validate the owner against org membership. Default pipeline seeding stays in the pipelines service. Use outbox for notifications and the stage-change engine.

### WD-API-050 — GET /deals/{id}: deal detail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-053, WD-DEAL-031
- **Summary:** Returns one deal in the public shape.
- **Actors & access:** any valid API key passing the plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri            | Route name        | Controller@action          | Middleware                             | Request | Response                                                         |
| --------------------- | ----------------- | -------------------------- | -------------------------------------- | ------- | ---------------------------------------------------------------- |
| GET api/v1/deals/{id} | api.v1.deals.show | Api\V1\DealController@show | api, auth.apikey, auth.apikey.throttle | path id | 200 `{data: deal}`; 404 `not_found`; 403 `plan_feature_disabled` |

- **Data:** reads `deals` (workspace), `pipeline_stages`. Shape as WD-API-048.
- **Rules & edge cases:**
  1. The plan gate runs before the lookup.
  2. A deal in another workspace returns 404 `not_found` ("Deal not found.").
  3. No activities, contact or owner objects are embedded; only ids.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `access_sales_pipeline`.
- **Acceptance criteria:**
  - Given an own deal, when GET, then 200 with `stage` name and `status`.
  - Given another workspace's deal id, then 404 `not_found`.
  - Given a plan without the feature, then 403 even for a non-existent id.
  - Given a won deal, then `won_at` is an ISO-8601 string and `lost_at` is null.
- **Source refs:** app/Http/Controllers/Api/V1/DealController.php, app/Models/Deal.php
- **Port notes:** `DealsService.get(uuid, scope)` with scope `'all'`; note `forContact` and other helpers read `ctx.grants!` and are unusable by keys. Optionally embed contact summary later (not in WaDesk).

### WD-API-051 — PUT /deals/{id}: partial update including stage move

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-054, WD-DEAL-033
- **Summary:** Updates any of title, value, currency, stage, contact, owner, expected close date and lost reason. Only the fields sent are applied. Changing the stage advances the deal and fires the stage-change engine.
- **Actors & access:** any valid API key passing the plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri            | Route name          | Controller@action            | Middleware                             | Request                                                                                       | Response                                                                                              |
| --------------------- | ------------------- | ---------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PUT api/v1/deals/{id} | api.v1.deals.update | Api\V1\DealController@update | api, auth.apikey, auth.apikey.throttle | title, value, currency, stage_id, contact_id, owner_user_id, expected_close_date, lost_reason | 200 `{data: deal}`; 404 `not_found`; 422 validation; 422 `unprocessable`; 403 `plan_feature_disabled` |

- **Data:** updates `deals`; writes `deal_activities` (stage change), `inbox_notifications`, possibly `flow_subscribers`.
- **Rules & edge cases:**
  1. Order: plan gate, deal lookup (404 before validation, so an unknown id with a bad body returns 404), validation, apply.
  2. All fields are optional ("sometimes"). `title` if present must be a non-empty string up to 191. `value` if present is nullable numeric 0 to 99,999,999 (null becomes 0). `currency` max 10, applied only if truthy (null or empty is ignored). `stage_id`, `contact_id`, `owner_user_id` nullable integers. `expected_close_date` nullable date. `lost_reason` nullable string up to 191.
  3. `pipeline_id` is not accepted; a deal cannot be moved to another pipeline.
  4. `stage_id` (truthy) must belong to the deal's own pipeline in this workspace, otherwise 422 `unprocessable` ("Stage not in this deal's pipeline."). Strict here, unlike create. `stage_id` null or 0 is ignored.
  5. `contact_id` present: an existing workspace contact is linked; an unknown id sets the contact to null; null or 0 clears it. QUIRK: an invalid contact id silently removes the existing link.
  6. `owner_user_id` falsy becomes null; truthy is stored with no membership check. QUIRK (same as create).
  7. Status, won time and lost time cannot be set directly; they follow the stage (WD-API-054). QUIRK: there is no way to mark a deal won or lost without moving it to a stage flagged won or lost; `lost_reason` alone on an open deal stores the reason without changing status. QUIRK: sending a move to an open stage together with a `lost_reason` loses the reason (the stage change clears it).
  8. A PUT with only non-stage fields writes no timeline row and fires no flow trigger.
- **Async & events:** see WD-API-054 for stage-driven events; owner-change notification when the owner changes to someone other than the key owner.
- **External systems:** none.
- **Settings:** `access_sales_pipeline`.
- **Acceptance criteria:**
  - Given an open deal, when PUT `{title:"New"}`, then 200, only the title changed and no timeline row is added.
  - Given a stage of the same pipeline, then 200 and `stage_id` updated; given a stage of another pipeline, then 422 `unprocessable`.
  - Given a PUT to a Won stage, then `status` won and `won_at` set; moved back to an open stage, then status open, `won_at` null and `lost_reason` null.
  - Given `contact_id` 999999 (unknown), then 200 and `contact_id` null.
  - Given an unknown deal id, then 404 `not_found`.
  - Given `value` null, then `value_minor` 0.
- **Source refs:** app/Http/Controllers/Api/V1/DealController.php, app/Models/Deal.php
- **Port notes:** map onto `DealsService.update` plus `moveStage`, `markWon`, `markLost` (all take explicit scope; use `'all'`). The target has explicit won/lost endpoints; decide whether the public API also exposes them (WaDesk has none, so record as an extension, not parity). Optimistic locking: accept optional `rowVersion`. `PUT` is really a patch; consider PATCH alias.

### WD-API-052 — DELETE /deals/{id}: delete a deal

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-053, WD-DEAL-034
- **Summary:** Permanently deletes a deal and its timeline.
- **Actors & access:** any valid API key passing the plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri               | Route name           | Controller@action             | Middleware                             | Request | Response                                                                  |
| ------------------------ | -------------------- | ----------------------------- | -------------------------------------- | ------- | ------------------------------------------------------------------------- |
| DELETE api/v1/deals/{id} | api.v1.deals.destroy | Api\V1\DealController@destroy | api, auth.apikey, auth.apikey.throttle | path id | 200 `{data:{deleted:true}}`; 404 `not_found`; 403 `plan_feature_disabled` |

- **Data:** hard-deletes the deal's `deal_activities` rows and then the `deals` row (no soft delete).
- **Rules & edge cases:**
  1. Plan gate first, then lookup; foreign or unknown id returns 404 `not_found`.
  2. No webhook, notification or flow trigger on delete; flow subscribers created by earlier stage triggers are not touched.
  3. A second DELETE of the same id returns 404.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `access_sales_pipeline`.
- **Acceptance criteria:**
  - Given an own deal with timeline entries, when DELETE, then 200 `deleted:true` and both the deal and its activities are gone.
  - Given another workspace's deal, then 404 and nothing is deleted.
  - Given a plan without the feature, then 403.
  - Given a repeat DELETE, then 404.
- **Source refs:** app/Http/Controllers/Api/V1/DealController.php, app/Models/Deal.php, app/Models/DealActivity.php
- **Port notes:** `DealsService.remove` (scope `'all'`); audit + outbox event (`deal.deleted`) in the same transaction; hard delete matches repo convention.

### WD-API-053 — Deals API plan gate (access_sales_pipeline) and admin bypass

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-DEAL-001, WD-DEAL-035, WD-PLAN-017
- **Summary:** Every deals endpoint is blocked unless the workspace's plan includes the sales pipeline feature. The check happens before validation and lookups.
- **Actors & access:** applies to all five deals endpoints. Workspace plan feature `access_sales_pipeline`; platform admin bypass based on the API key owner's role.
- **UX & screens:** none.
- **Endpoints:** guard on `GET/POST api/v1/deals` and `GET/PUT/DELETE api/v1/deals/{id}` (WD-API-048 to WD-API-052).
- **Data:** reads `workspaces`, the plan's feature limits (including add-ons) and the key owner's roles.
- **Rules & edge cases:**
  1. The gate passes when the workspace's effective feature value for `access_sales_pipeline` is truthy (default assumed true when no limit is defined).
  2. Bypass: if the API key owner is a platform Super Admin or Admin (role system) or has the legacy admin role value, the gate passes regardless of plan.
  3. A missing workspace row fails the gate.
  4. Failure is HTTP 403 with code `plan_feature_disabled` and a message that the plan does not include the Sales Pipeline and should be upgraded.
  5. The gate precedes validation and 404 checks: an invalid body or unknown id on a gated workspace still returns 403.
  6. Other API areas in this file (templates, auto-replies, flows) have no plan feature gate on the v1 path. QUIRK:
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package feature `access_sales_pipeline` (admin packages), add-ons.
- **Acceptance criteria:**
  - Given a plan without the feature, when any deals endpoint is called, then 403 `plan_feature_disabled`.
  - Given a plan with the feature, then the endpoints behave per their entries.
  - Given a gated plan and an unknown deal id with an invalid body, then 403 (not 404 or 422).
  - Given a key owned by an admin user on a plan without the feature, then access is allowed.
  - Given the plan is upgraded, then the next call succeeds without re-creating the key.
- **Source refs:** app/Http/Controllers/Api/V1/DealController.php, app/Services/PlanLimitGuard.php
- **Port notes:** target uses `SalesPipelineGuard` (deals-plan `assertEnabled(orgId)`, feature key `sales_pipeline`) on staff controllers; a public controller must apply it explicitly because the global `PlanFeatureGuard` and `TrialGateGuard` skip `@Public()` routes. Also apply `@RequirePlanFeature('public_api')` at class level (ApiKeyGuard enforces it). Platform admin bypass by key owner role has no clean equivalent (keys have no user role in the target); decide whether to drop it (recommended) and record it as an intended difference.

### WD-API-054 — Deal stage change via API: status sync, timeline row, flow trigger, notification

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-DEAL-008, WD-DEAL-018, WD-DEAL-027, WD-FLR-011
- **Summary:** When an API call changes a deal's stage (on create or update), status and timestamps follow the stage, a timeline entry is written, a "deal stage changed" flow can start for the linked contact, and owners are notified of outcomes.
- **Actors & access:** triggered by `POST /deals` (stage set on create) and `PUT /deals/{id}` with a changed `stage_id`. Same plan gate.
- **UX & screens:** none.
- **Endpoints:** side effects of WD-API-049 and WD-API-051.
- **Data:** writes `deals` (status, won time, lost time, lost reason), `deal_activities` (type stage_change with from and to stage ids, user = key owner, update only), `flow_subscribers`, `inbox_notifications`; reads `flows`, `contacts`.
- **Rules & edge cases:**
  1. Whenever the stage id changes (always on create): stage flagged won gives status won, won time = existing or now, lost time cleared; stage flagged lost gives status lost, lost time = existing or now, won time cleared; any other stage gives status open and clears won time, lost time and lost reason.
  2. Setting the same stage again is not a change: no timeline row, no trigger.
  3. On update only: a timeline entry is written with the previous and new stage ids.
  4. On update only: if the deal has a linked contact that still exists, the contact is enrolled into every flow of the workspace that is active AND published, has trigger kind `deal_stage_changed`, and whose trigger value equals the new stage id. Enrollment follows the standard rules (idempotent per flow and contact; launches via the Node runtime; failures are swallowed per flow). No contact means no trigger.
  5. Won or lost transition: the owner is notified (title "Deal won"/"Deal lost", body with title, value and lost reason, deduped 30 s) unless the owner is the actor (the key owner) or there is no owner. Owner change to a different user than the key owner notifies the new owner.
  6. Notification failures and flow trigger failures are logged and swallowed; they never block the update.
  7. QUIRK: because the actor is always the key owner, an owner who happens to be the key owner never gets outcome notifications for API-made moves.
- **Async & events:** synchronous model hooks; flow launch is a synchronous HTTP call to the Node runtime per matching flow (WD-FLR-011); in-app notification rows and optional web push.
- **External systems:** Node flow runtime (via enrollment), web push when enabled.
- **Settings:** `ti_pwa_enabled`, Node bridge URL.
- **Acceptance criteria:**
  - Given an open deal, when PUT stage_id of the Won stage, then status won, `won_at` set, and a stage_change timeline row exists with the correct from and to ids.
  - Given a won deal, when PUT stage_id of an open stage, then status open and `won_at`, `lost_at` and `lost_reason` are null.
  - Given an active published flow with trigger deal_stage_changed for stage X and a deal with a linked contact, when PUT stage_id X, then a flow subscriber row exists for that contact and flow; with no linked contact, then none.
  - Given a PUT with the same stage as current, then no timeline row and no flow subscriber is added.
  - Given a deal with an owner different from the key owner, when moved to Lost, then the owner receives a "Deal lost" notification.
  - Given a draft (unpublished) matching flow, then it is not triggered.
- **Source refs:** app/Models/Deal.php, app/Models/DealActivity.php, app/Services/Flow/FlowEnrollmentService.php, app/Services/Inbox/NotificationDispatcher.php, app/Http/Controllers/Api/V1/DealController.php
- **Port notes:** target `DealEngine` and `DealsService.moveStage/markWon/markLost` own this; emit `deal.stage_changed` via the outbox and let the flows subscriber enroll (`FlowTriggerService`) rather than calling enrollment inline. Timeline via `DealActivitiesService`. Notifications through the notifications domain with the same dedupe. `ctx.userId` is null for api keys, so actor-based suppression logic needs an api-actor rule (decide: key creator or no suppression) and timeline `user_id` must tolerate null.

### WD-API-080 — Create a broadcast (POST broadcasts)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-BCAST-009, WD-BCAST-010, WD-BCAST-011, WD-BCAST-012, WD-BCAST-013, WD-BCAST-015, WD-BCAST-016, WD-BCAST-029, WD-PLAN-017
- **Summary:** An API client sends one approved template to a list of contact ids and/or one contact group, now or at a later time, and gets the new broadcast back. It is a thin adapter: it renames the public fields, re-scopes every id to the key's workspace, then runs the same pipeline as the web "new broadcast" form (plan gates, opt-out removal, wallet check, template guards, warmer, row creation, Node hand-off).
- **Actors & access:** API key only, workspace taken from the key (the key owner becomes the broadcast creator). Gates: API key authentication and per-plan rate limit (WD-API-005/006); plan feature `broadcast`; numeric plan limit `broadcast_limit`; wallet precheck. Platform admin owners bypass plan limits. API-key `scopes` are stored but never checked (QUIRK).
- **UX & screens:** none.
- **Endpoints:**

| Method uri             | Route name              | Controller@action                | Middleware                             | Request                                                                                                                                                                                                                                                                                                                               | Response                                                                                                                                                                                          |
| ---------------------- | ----------------------- | -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST api/v1/broadcasts | api.v1.broadcasts.store | Api\V1\BroadcastController@store | api, auth.apikey, auth.apikey.throttle | `name` (required, string, max 255); `template_id` (required, integer); `recipients` (array of integer contact ids, required when no group_id); `group_id` (integer, required when no recipients); `device_id` (nullable integer); `schedule_at` (nullable string max 64, any parseable datetime); `timezone` (nullable string max 64) | 201 `{data: broadcast, meta:{broadcast_ids:[...], devices_count}}`; 422 `invalid_group`, `no_recipients`, `invalid_template`, `create_failed`; plan gate renders a different 422 body (see rules) |

- **Data:** reads `contacts` (workspace scope, encrypted group membership list, opt-out flag), `contact_groups`, `wa_templates`, `devices` / provider configs (sender), `broadcasts` (count for the plan limit), owner's wallet credits, system settings. Writes `broadcasts` (status `processing` for now, `scheduled` for later, `total_recipients`, `timezone` default UTC, `scheduled_at`) and one `broadcast_contacts` row per recipient with status `pending`. Response `broadcast` object: id, name, status, template_id, device_id, total_recipients, counts{sent, delivered, read, failed, clicked, pending}, scheduled_at, completed_at, created_at, updated_at (ISO-8601 with offset).
- **Rules & edge cases:**
  1. Adapter scoping runs first: recipient ids are de-duplicated and silently filtered to the workspace; the group must exist in the workspace else 422 `invalid_group`; if no recipient survives and no group, 422 `no_recipients`; the template must be visible to the workspace (own, global admin-seeded, or legacy user-owned) else 422 `invalid_template`.
  2. `schedule_at` present means send later (date and time-of-day taken from the parsed value); absent means send now. QUIRK: the UTC offset inside `schedule_at` and the `timezone` field do not convert the time; only the wall-clock date and hour:minute are kept and re-read in the server's own timezone. `timezone` is just stored and passed to Node. A past `schedule_at` is accepted. An unparseable value is not validated and causes a server error.
  3. The web pipeline then applies: plan feature `broadcast` and count limit `broadcast_limit` over ALL broadcasts of the workspace (live count, not delete-proof); group members are found by scanning all workspace contacts; contacts flagged as opted out are dropped; if none remain the request is refused.
  4. Wallet precheck (empty wallet blocks pay-per-message or out-of-quota workspaces); template guards (OTP/authentication templates refused; media header must be a public HTTPS URL; Meta-approved templates must be approved, not paused, quality not RED when the v2 template flag is on); warmer hold when the chosen number is warming and outside hours or over budget (WD-BCAST-011/012/013).
  5. QUIRK: every refusal inside the web pipeline is a "redirect back with error" response; the adapter then calls a JSON accessor on it, so those refusals most likely surface as HTTP 500 instead of a clean 422, and the human reason is lost. The adapter's `create_failed` branch is effectively dead. A port must return a proper 422 with the reason.
  6. Plan-gate failures are thrown as a plan-limit exception and are not caught by the adapter, so the client gets 422 `{ok:false, error:"plan_limit_reached", reason: feature_disabled|limit_reached, key, used, limit, message}`, not the standard `{error:{code,message}}` envelope (QUIRK, differs from campaigns which return 402 `plan_limit`).
  7. `device_id` is resolved as a bare id on the workspace's default engine; if it does not resolve to a usable sender it is silently ignored and a device-less broadcast is created (Node dispatch then picks the workspace's most recent connected device or fails the broadcast). The API cannot express multi-sender split, tags, send-time template overrides or Instagram broadcasts.
  8. 201 is returned even when hand-off failed (broadcast `status` = `failed`) or when no Node URL is configured (status stays processing/scheduled forever).
  9. Response is the first created broadcast re-read after dispatch, so `status` reflects the hand-off result. `devices_count` is 1 for API calls.
- **Async & events:** immediate or scheduled hand-off to the Node bridge; model event emits outgoing webhook `broadcast_created` and later `broadcast_status_updated` (WD-BCAST-029); Node status callbacks update recipients and counters (WD-BCAST-025/026/027); inbox mirror for immediate sends (WD-BCAST-028); warmer ledger reservation; click-tracking shortlinks.
- **External systems:** Node bridge `POST /api/broadcast/send-immediate/{phone}` or `/api/broadcast/schedule/{phone}` (15 s timeout, token from node settings); SMS-engine broadcasts run in PHP instead of Node.
- **Settings:** plan feature `broadcast`, plan limit `broadcast_limit`, `api_rate_limit_per_minute` (plan) / `security.api_rate_limit_per_minute` (default 600), `waba_templates_v2_enabled`, Node server URL (`baileys_server_url` or env), `security.wa_guardrails_mode`.
- **Acceptance criteria:**
  - Given a valid key and two workspace contacts, when POST with `name`, `template_id` and `recipients`, then 201, `data.status` is `processing`, `data.total_recipients` is 2, `meta.broadcast_ids` has one id.
  - Given recipients that all belong to another workspace and no group, then 422 `no_recipients` and no broadcast row is created.
  - Given a `template_id` from another workspace, then 422 `invalid_template`.
  - Given `group_id` of a group in another workspace, then 422 `invalid_group`.
  - Given `schedule_at` one day ahead, then 201, `data.status` is `scheduled` and `scheduled_at` is that day.
  - Given the workspace plan has reached `broadcast_limit`, then 422 with `error` = `plan_limit_reached` and `key` = `broadcast_limit` (decide whether to normalise to the v1 envelope).
  - Given a recipient flagged opted-out is the only recipient, then the request is refused and no row is created (target must return 422, not 500).
  - Given no `recipients` and no `group_id`, then 422 validation error.
- **Source refs:** routes/api/v1/broadcasts.php; app/Http/Controllers/Api/V1/BroadcastController.php; app/Http/Controllers/Api/V1/V1Controller.php; app/Http/Requests/Api/V1/Broadcast/StoreBroadcastRequest.php; app/Http/Resources/Api/V1/BroadcastResource.php; app/Http/Controllers/BroadcastsController.php (store, dispatchToBridge); app/Models/Broadcast.php; app/Services/PlanLimitGuard.php; app/Exceptions/PlanLimitReachedException.php; app/Support/SendGate.php; app/Services/MessageBillingService.php
- **Port notes:** The staff-side engine already exists: `apps/api/src/modules/broadcasts` `BroadcastsService.create(body)` (plan gate, `entitlements.assertWithinLimit('broadcasts')`, audience resolution, wallet precheck, audience plan cap) needs no RBAC grants and tolerates a null `ctx.userId`, so it is usable by an api-key actor. Gaps: `BroadcastsService` (and the read/actions services) is not exported from the module `index.ts` nor from `BroadcastsModule` `exports:`; add both before a new public controller (suggest `public/v1/broadcasts`, `@Public() @UseGuards(ApiKeyGuard)`, `@RequirePlanFeature('public_api')`, version-neutral, in `modules/public-api` or `modules/broadcasts`). `createBroadcastSchema` takes uuids and sender keys `<engine>:<uuid>`, so the public contract must be uuid-only (no bigint ids) and map `recipients` to `contactIds`, `group_id` to `groupIds`, `device_id` to a sender key via `SENDER_DIRECTORY`; decide whether an unresolvable device is a 422 (recommended) rather than WaDesk's silent fallback. Fix the quirks instead of copying them: honour `timezone` for `schedule_at`, validate the datetime, return a proper 422 for gate refusals and use the standard envelope for plan-limit errors (WD-API-007). Add the contract to `@crm/contracts`; add an e2e under `test/e2e/broadcasts` following the api-key pattern in `plans-subscriptions-trials/billing.e2e.spec.ts`.

### WD-API-081 — List broadcasts (GET broadcasts)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-BCAST-001
- **Summary:** Returns the newest broadcasts of the workspace, optionally filtered by status. There is no paging beyond a size limit.
- **Actors & access:** API key; workspace from the key. No plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri            | Route name              | Controller@action                | Middleware                             | Request                                                                    | Response                                           |
| --------------------- | ----------------------- | -------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| GET api/v1/broadcasts | api.v1.broadcasts.index | Api\V1\BroadcastController@index | api, auth.apikey, auth.apikey.throttle | `limit` (int, default 50, clamped 1..200); `status` (optional exact match) | `{data:[broadcast], meta:{count}}` newest id first |

- **Data:** reads `broadcasts` visible to the workspace (own workspace rows plus legacy rows without workspace owned by the key owner). Per item `counts` come from cached counters or a live count (WD-API-082).
- **Rules & edge cases:**
  1. Order is by id descending; no offset or cursor, so anything older than the newest 200 cannot be reached (QUIRK, port should use cursor pagination per repo convention).
  2. `status` is not validated and `all` is not special; unknown values give an empty list. Statuses seen: processing, scheduled, completed, completed_with_errors, failed, cancelled.
  3. Engine/provider scope is not applied: broadcasts of every channel are listed.
  4. Non-numeric `limit` becomes 1 after clamping.
  5. Each item may trigger extra queries for counts (N+1).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** API rate limit only.
- **Acceptance criteria:**
  - Given 3 broadcasts, when GET with no params, then 200, `data` has 3 items newest first and `meta.count` is 3.
  - Given `limit=2`, then only 2 items are returned.
  - Given `limit=1000`, then at most 200 items are returned.
  - Given `status=scheduled`, then only scheduled broadcasts are returned.
  - Given broadcasts of another workspace, then none are returned.
  - Given no or an invalid key, then 401 `missing_api_key` / `invalid_api_key`.
- **Source refs:** routes/api/v1/broadcasts.php; app/Http/Controllers/Api/V1/BroadcastController.php (index); app/Http/Resources/Api/V1/BroadcastResource.php; app/Models/Broadcast.php
- **Port notes:** `BroadcastsReadService.list` exists (not exported; needs export). Use the repo's cursor pagination and uuid ids instead of `limit`-only; keep `status` as an enum filter. Public response should reuse a contract shaped like the resource (id, name, status, templateId, deviceId, totalRecipients, counts, scheduledAt, completedAt, createdAt, updatedAt).

### WD-API-082 — Read one broadcast with status counts (GET broadcasts/{id})

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-BCAST-027
- **Summary:** Returns one broadcast with cascaded delivery counts so clients can poll progress.
- **Actors & access:** API key; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                 | Route name             | Controller@action               | Middleware                             | Request         | Response                                                    |
| -------------------------- | ---------------------- | ------------------------------- | -------------------------------------- | --------------- | ----------------------------------------------------------- |
| GET api/v1/broadcasts/{id} | api.v1.broadcasts.show | Api\V1\BroadcastController@show | api, auth.apikey, auth.apikey.throttle | path id numeric | `{data: broadcast}`; 404 `not_found` "Broadcast not found." |

- **Data:** `broadcasts` counters (`success_count`, `delivered_count`, `read_count`, `fail_count`, `clicked_count`, `total_recipients`); slow path reads `broadcast_contacts` and `wa_link_clicks`.
- **Rules & edge cases:**
  1. Counts are cascaded: `sent` includes delivered and read; `delivered` includes read.
  2. Fast path: when any cached counter is above zero, counts come from the counters and `pending` = total minus sent minus failed (floored at 0). Slow path (all counters zero): live counts from `broadcast_contacts`, `clicked` = distinct contacts with clicks.
  3. A recipient being processed is counted as pending (the `processing` bucket exists internally but is not exposed).
  4. Timestamps are ISO-8601 with offset (unlike campaigns).
  5. Non-numeric id fails route matching and gets the framework 404, not the v1 error envelope (QUIRK).
- **Async & events:** counters are maintained by Node status callbacks and provider webhooks (WD-BCAST-025..027).
- **External systems:** none.
- **Settings:** API rate limit.
- **Acceptance criteria:**
  - Given a broadcast with 10 recipients of which 6 delivered and 2 read, then `counts.sent` >= 6, `counts.delivered` is 6 and `counts.read` is 2.
  - Given a broadcast with no webhooks yet, then counts come from recipient rows and `pending` equals total recipients.
  - Given an id of another workspace or a missing id, then 404 with code `not_found`.
  - Given a cancelled broadcast, then `status` is `cancelled` and `completed_at` is set.
- **Source refs:** routes/api/v1/broadcasts.php; app/Http/Controllers/Api/V1/BroadcastController.php (show); app/Http/Resources/Api/V1/BroadcastResource.php; app/Models/Broadcast.php (status_counts)
- **Port notes:** `BroadcastsReadService.detail(uuid)` is usable by an api key but not exported. Public id must be the uuid. Return a trimmed projection, not the staff detail (charts, events). Keep the cascade definition identical to the existing target counters.

### WD-API-083 — List broadcast recipients (GET broadcasts/{id}/recipients)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-082, WD-BCAST-032, WD-BCAST-036
- **Summary:** Per-recipient delivery rows for a broadcast plus an aggregate stats block, newest first, up to a limit.
- **Actors & access:** API key; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                            | Route name                   | Controller@action                     | Middleware                             | Request                                    | Response                                                                                                                                                                        |
| ------------------------------------- | ---------------------------- | ------------------------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET api/v1/broadcasts/{id}/recipients | api.v1.broadcasts.recipients | Api\V1\BroadcastController@recipients | api, auth.apikey, auth.apikey.throttle | `limit` (int, default 100, clamped 1..500) | `{data:[{contact_id, status, error, wa_message_id, sent_at, delivered_at, read_at}], meta:{count, stats:{sent, delivered, read, failed, processing, queued}}}`; 404 `not_found` |

- **Data:** reads `broadcast_contacts` (ordered by id desc), stats grouped by status with the same cascade as WD-API-082.
- **Rules & edge cases:**
  1. No paging beyond `limit` (max 500), no status filter, no contact name or phone (only `contact_id`).
  2. `status` falls back to `pending` when empty.
  3. QUIRK: the rows come from a raw query that bypasses the model's encryption-tolerant cast, so `error` can be ciphertext or plaintext depending on who wrote it.
  4. QUIRK: `meta.stats` (processing, queued) uses different bucket names from the broadcast `counts` (pending, clicked) and is computed live, so the two can disagree.
  5. Times are raw database strings without offset.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** API rate limit.
- **Acceptance criteria:**
  - Given a broadcast with 150 recipients, when GET with no limit, then 100 rows and `meta.count` 100.
  - Given `limit=600`, then at most 500 rows.
  - Given one failed recipient with a reason, then its row has `status` `failed` and a readable `error`.
  - Given a broadcast of another workspace, then 404 `not_found`.
  - Given a recipient still waiting, then its `status` is `pending`.
- **Source refs:** routes/api/v1/broadcasts.php; app/Http/Controllers/Api/V1/BroadcastController.php (recipients); app/Http/Controllers/BroadcastsController.php (statistics); app/Models/BroadcastContact.php
- **Port notes:** `BroadcastsReadService.recipients(uuid, q)` and `statistics` exist. Decide a stable cursor and expose contact uuid; decrypt or sanitise `error` consistently and use ISO-8601 timestamps. Never expose phone numbers unless a product decision says so.

### WD-API-084 — Stop a broadcast (POST broadcasts/{id}/stop)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-082, WD-BCAST-040, WD-BCAST-029
- **Summary:** Cancels a scheduled or in-flight broadcast: local status becomes cancelled and a best-effort cancel goes to the Node bridge.
- **Actors & access:** API key; workspace scoped; no plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                       | Route name             | Controller@action               | Middleware                             | Request | Response                                                                            |
| -------------------------------- | ---------------------- | ------------------------------- | -------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| POST api/v1/broadcasts/{id}/stop | api.v1.broadcasts.stop | Api\V1\BroadcastController@stop | api, auth.apikey, auth.apikey.throttle | none    | `{data: broadcast}` with `status` `cancelled`; 404 `not_found`; 422 `not_stoppable` |

- **Data:** updates `broadcasts.status` = `cancelled`, `completed_at` = now if empty.
- **Rules & edge cases:**
  1. Only `scheduled` and `processing` can be stopped; anything else is 422 "Only scheduled or in-flight broadcasts can be stopped."
  2. If the broadcast has a Node schedule id and a Node URL is configured, `DELETE /api/broadcast/cancel/{id}` is sent with a 5 s timeout; failure is only logged and the local change still happens. The call carries no node token in this path (QUIRK).
  3. QUIRK: immediate broadcasts have no Node schedule id, so no cancel is sent and Node may keep sending while the status reads cancelled.
  4. Recipient rows stay `pending`; no wallet refund; warmer reservation is not released.
  5. `cancelled` is not in the model's status list and not in the web status buckets.
  6. The status change emits `broadcast_status_updated` with the previous status.
- **Async & events:** outgoing webhook `broadcast_status_updated` (WD-BCAST-029); Node cancel call.
- **External systems:** Node bridge cancel endpoint.
- **Settings:** Node server URL.
- **Acceptance criteria:**
  - Given a scheduled broadcast, when POST stop, then 200, `data.status` is `cancelled`, `completed_at` is set.
  - Given a completed broadcast, then 422 `not_stoppable` and the status is unchanged.
  - Given an unknown or foreign id, then 404 `not_found`.
  - Given a subscribed webhook, when the broadcast is stopped, then a `broadcast_status_updated` delivery with `previous_status` is queued.
  - Given Node is unreachable, then the broadcast is still cancelled locally and the call returns 200.
- **Source refs:** routes/api/v1/broadcasts.php; app/Http/Controllers/Api/V1/BroadcastController.php (stop); app/Http/Controllers/BroadcastsController.php (destroy for the shared cancel call); app/Models/Broadcast.php
- **Port notes:** The target has `BroadcastsActionsService` (delete, retryFailed, resume, export) but no obvious "cancel/stop" that matches; confirm and add one in the broadcasts module (job cancellation via the queue, not an in-memory Node store) rather than copying the status flip. Emit the status change through the outbox, in the same transaction as the update. Stopping should also release pending recipients and not leave them `pending`.

### WD-API-085 — Campaign statistics rollup (GET campaigns/statistics)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-CAMP-001
- **Summary:** One workspace-wide summary of campaigns by status plus message totals and delivery/read/click/response rates.
- **Actors & access:** API key; workspace scoped; the mobile app's "selected sender" filter is never applied here.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                      | Route name                  | Controller@action                    | Middleware                             | Request | Response                                                                                                                                                                                                                            |
| ------------------------------- | --------------------------- | ------------------------------------ | -------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET api/v1/campaigns/statistics | api.v1.campaigns.statistics | Api\V1\CampaignController@statistics | api, auth.apikey, auth.apikey.throttle | none    | `{data:{campaigns:{total, active, completed, scheduled, failed}, messages:{total_recipients, sent, delivered, read, failed, clicked, responded}, rates:{delivery_rate, read_rate, click_rate, response_rate}}}`; 422 `stats_failed` |

- **Data:** reads all `wpcampaigns` of the workspace and sums cached counter columns.
- **Rules & edge cases:**
  1. `active` counts only status `processing`; just-created campaigns (`running`), recurring (`active`) and `stopped`/`draft` appear only in `total` (QUIRK).
  2. Rates are rounded to 2 decimals: delivery = delivered/sent, read = read/delivered, click = clicked/sent, response = responded/sent; 0 when the denominator is 0.
  3. No date window and no filters; loads every campaign (performance, all-time).
  4. The route is registered before `/campaigns/{id}`; keep that ordering.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** API rate limit.
- **Acceptance criteria:**
  - Given 2 completed and 1 scheduled campaign, then `campaigns.total` is 3, `completed` 2, `scheduled` 1.
  - Given campaigns with sent 100 and delivered 80, then `rates.delivery_rate` is 80.
  - Given no campaigns, then all numbers are 0.
  - Given a campaign in another workspace, then it is not counted.
- **Source refs:** routes/api/v1/campaigns.php; app/Http/Controllers/Api/V1/CampaignController.php (statistics); app/Http/Controllers/Api/App/CampaignController.php (statistics); app/Models/WpCampaign.php
- **Port notes:** target `CampaignsReadService` has list/detail/live but no workspace rollup was found; add a SQL aggregate (not load-all-rows). Define `active` explicitly (include running and active) and document it. Services in `modules/campaigns` are not exported yet (module `exports:` lists repo/events/jobs only).

### WD-API-086 — List campaigns (GET campaigns)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-CAMP-001
- **Summary:** Returns every campaign of the workspace, newest first, with counts and rates.
- **Actors & access:** API key; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri           | Route name             | Controller@action               | Middleware                             | Request                                                                                                                  | Response                                             |
| -------------------- | ---------------------- | ------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| GET api/v1/campaigns | api.v1.campaigns.index | Api\V1\CampaignController@index | api, auth.apikey, auth.apikey.throttle | `status`, `campaign_type` (exact match), `search` (case-insensitive substring of the name); all optional and unvalidated | `{data:[campaign], meta:{count}}`; 422 `list_failed` |

- **Data:** reads `wpcampaigns`. Campaign object: id, name, type, status, device_id, template_id, flow_id, ab_testing, ab_split, counts{total_recipients, sent, delivered, read, failed, clicked, responded}, metrics{delivery_rate, read_rate, click_rate, response_rate} (2 decimals), schedule_type, scheduled_for (ISO-8601 UTC from send date + time in the campaign timezone), timezone, created_at, updated_at, completed_at (formatted `Y-m-d H:i:s`, no offset).
- **Rules & edge cases:**
  1. No limit, page or cursor: all campaigns are returned (QUIRK); `limit` is ignored.
  2. `search` loads all campaigns and filters in PHP because the name is encrypted at rest.
  3. Types: text, template, button, flow, media, custom. Statuses seen: running, scheduled, processing, active, completed, failed, stopped, draft.
  4. Date format differs from broadcasts and scheduled (QUIRK).
  5. The list resource drops fields the internal transform has (device name, template names, custom message, media URLs, channel badge, creator).
  6. Engine and selected-sender scopes are not applied.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** API rate limit.
- **Acceptance criteria:**
  - Given 3 campaigns, then `data` has 3 items newest first and `meta.count` 3.
  - Given `status=completed`, then only completed campaigns are returned.
  - Given `search=spring`, then only campaigns whose name contains "spring" (any case) are returned.
  - Given a campaign with sent 50 and delivered 40, then `metrics.delivery_rate` is 80.
  - Given another workspace's campaigns, then none are returned.
- **Source refs:** routes/api/v1/campaigns.php; app/Http/Controllers/Api/V1/CampaignController.php (index); app/Http/Resources/Api/V1/CampaignResource.php; app/Http/Controllers/Api/App/CampaignController.php (index, transformCampaign); app/Models/WpCampaign.php
- **Port notes:** `CampaignsReadService.list` exists (not exported). Add pagination and ISO-8601 dates; keep filters as enums. If name search is kept, note the target's encrypted-name handling.

### WD-API-087 — Create and dispatch a campaign (POST campaigns)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-API-095, WD-CAMP-003, WD-CAMP-004, WD-CAMP-005, WD-CAMP-006, WD-CAMP-007, WD-CAMP-008, WD-CAMP-011, WD-PLAN-017, WD-PLAN-018, WD-WALLET-013
- **Summary:** An API client creates a campaign (template, custom text, or flow; optional A/B) addressed to a list of phone numbers and chooses to send now, at a time, or on a repeat. The adapter maps the request into the web campaign form so the full launch pipeline runs (plan quota, template gates, recipient rows, paced sending).
- **Actors & access:** API key; plan feature `campaign`; numeric plan quota `total_campaigns_limit` checked against the delete-proof usage ledger (WD-PLAN-018); platform-admin owners bypass. Wallet precheck (count 1) and content guardrails. Scopes unchecked.
- **UX & screens:** none.
- **Endpoints:**

| Method uri            | Route name             | Controller@action               | Middleware                             | Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Response                                                                                      |
| --------------------- | ---------------------- | ------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| POST api/v1/campaigns | api.v1.campaigns.store | Api\V1\CampaignController@store | api, auth.apikey, auth.apikey.throttle | `campaign_name` (required, string, max 255; inner limit 191); `device_id` (required; integer id or `cfg_<n>`); `campaign_type` (required: custom, template, flow); `schedule_type` (required: now, later, recurring); `template_id`, `template_id_a`, `template_id_b`, `flow_id` (nullable integers); `custom_message` (required when custom, max 4096); `send_date` (date) and `send_time` (string max 16), both required when `later`; `timezone` (nullable string max 64, must be a valid IANA zone inside); `ab_testing` (boolean-ish); `ab_split` (integer 10..90, default 50); `contacts` (required array, min 1, each string max 32) | 201 `{data: campaign}`; 422 `create_failed` (with `details` for validation); 402 `plan_limit` |

- **Data:** writes `wpcampaigns` (status `running` for now, `scheduled` otherwise; recurring gets repeat interval `weekly`, no end date; timezone = request, else workspace, else app default; `created_by` = key owner), `wpcampaign_contacts` (one row per recipient, status `queued`, A/B `variant` by shuffled split), `contacts` (find-or-create per number, WD-API-095), `plan_usage` counter for metric `campaign`. Reads `wa_templates`, `flows`, devices, provider configs, settings, wallet.
- **Rules & edge cases:**
  1. `schedule_type` `later` is mapped to `scheduled` in the web layer and echoed back as `scheduled`.
  2. Web layer re-validates: valid IANA timezone (else 422 `create_failed` with details), name max 191, ab_split bounds, expiry-after-send check.
  3. Template gate (template campaigns with a template id): must be visible to the workspace ("Template not found."); on a WABA-engine workspace it must be approved/public; authentication (OTP) templates refused; Meta v2 templates need approved status, not paused, quality at or above the admin floor (default YELLOW; UNKNOWN passes), reachable media URL. Variant-B template and flow ids must belong to the workspace. Business refusals come back as 422 `create_failed` with the first message.
  4. Quota exceeded or feature disabled gives 402 `plan_limit` with the plan message (broadcasts return 422 for the same condition, QUIRK inconsistency).
  5. `custom_message` is screened by the send guardrails (monitor/enforce modes) and the wallet precheck blocks an empty wallet.
  6. `schedule_type=now`: sending runs after the HTTP response (or inline on hosts without that capability, which makes the API call slow). Drops unsubscribed contacts, collapses duplicate phone numbers, paces by admin gap and batch settings, bills at delivery. `later`/`recurring` are armed for the sweeper and nothing is sent at create time.
  7. QUIRK: the response is the raw stored campaign, not the list/detail shape: `counts` and `metrics` are all 0 (even `total_recipients`), `scheduled_for` is null, and `created_at`/`updated_at` use model serialisation (ISO with fraction) instead of `Y-m-d H:i:s`. A GET right after returns the real numbers.
  8. QUIRK: `template` campaigns do not require `template_id` and `flow` campaigns do not require `flow_id`; the campaign is created and fails at send time.
  9. QUIRK: recurring cannot be configured (no repeat interval, repeat-until, end date, send window, throttle, batch, daily limit); `send_date`/`send_time` are not required for recurring. No media, buttons, groups, tags or existing contact ids can be supplied.
  10. Numbers with fewer than 8 digits are silently dropped; if all are dropped a zero-recipient campaign is still created and consumes quota.
  11. QUIRK: a bare numeric `device_id` is not checked against the workspace at creation (only `cfg_` ids and composite sender keys are).
- **Async & events:** outgoing webhook `campaign_created` on insert and `campaign_status_updated` on every status change (WD-CAMP-024); after-response paced send job; sweeper for scheduled and recurring (WD-CAMP-014); Node status callbacks (WD-CAMP-021); PlanUsage increment on create.
- **External systems:** Node bridge or Cloud API / Twilio senders per engine; SMS and email runners for those engines (WD-CAMP-028).
- **Settings:** plan feature `campaign`, plan limit `total_campaigns_limit`, `allowed_send_methods` / `default_send_method`, `waba_templates_v2_enabled`, `waba_template_quality_floor`, `security.wa_guardrails_mode`, admin message gap and batch settings, workspace timezone.
- **Acceptance criteria:**
  - Given a valid body with `schedule_type=now`, `campaign_type=custom`, a message and two numbers, then 201, `data.status` is `running`, `data.name` matches, and two recipient rows exist in `queued` or later status.
  - Given `schedule_type=later` without `send_date`, then validation error 422.
  - Given `schedule_type=later` with a future date/time and a zone `Asia/Kolkata`, then 201, `data.schedule_type` is `scheduled`, and a later GET shows `scheduled_for` matching that local time.
  - Given `timezone=Mars/Base`, then 422 `create_failed` with details on the timezone field.
  - Given a template of another workspace, then 422 `create_failed` "Template not found."
  - Given an authentication-type template, then 422 `create_failed`.
  - Given the plan quota is exhausted, then 402 `plan_limit`; deleting a campaign does not reopen it.
  - Given `ab_testing=true`, `ab_split=70` and 10 recipients, then 7 recipients are assigned variant A and 3 variant B.
  - Given `ab_split=5`, then 422.
- **Source refs:** routes/api/v1/campaigns.php; app/Http/Controllers/Api/V1/CampaignController.php (store); app/Http/Requests/Api/V1/Campaign/StoreCampaignRequest.php; app/Http/Resources/Api/V1/CampaignResource.php; app/Http/Controllers/WaCampaignsController.php (store, dispatchCampaignNow, runCampaignNowPaced, assertExpiryAfterSend, fireScheduledCampaign); app/Models/WpCampaign.php; app/Models/Contact.php (rememberPhone); app/Services/PlanLimitGuard.php (checkQuota); app/Support/SendGate.php
- **Port notes:** `modules/campaigns` has `CampaignsService.create(input)` (audience resolver, `createdBy: ctx.userId` nullable) and `CampaignsActionsService`/`CampaignsReadService`, none using grants; the services are not exported from the barrel or module (add exports). `createCampaignSchema` is the internal contract; build a public contract mapping `contacts` (phones) through WD-API-095, `device_id` to a sender key, and keep uuid-only ids. Audience resolution scoping by user id must be verified with a null user. Return the same shape as GET (WD-API-088) on create, fix the zero counts quirk, make flow/template ids required for their type, expose the recurring and window options, validate the device against the workspace, and return a standard envelope for plan errors (WD-API-007). Gate the controller with `@RequirePlanFeature('public_api')`. The send itself belongs to the worker (BullMQ), never inline in the request. e2e under `test/e2e/campaigns`.

### WD-API-088 — Read one campaign with live counts (GET campaigns/{id})

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-086, WD-CAMP-019
- **Summary:** Returns one campaign in the same shape as the list, plus live counts and rates computed from its recipient rows.
- **Actors & access:** API key; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                | Route name            | Controller@action              | Middleware                             | Request                                        | Response                                                                                                                                                                     |
| ------------------------- | --------------------- | ------------------------------ | -------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET api/v1/campaigns/{id} | api.v1.campaigns.show | Api\V1\CampaignController@show | api, auth.apikey, auth.apikey.throttle | path id numeric; no query params are forwarded | `{data: campaign, meta:{counts:{total, sent, delivered, read, failed, clicked, responded}, metrics:{delivery_rate, read_rate, click_rate, response_rate}}}`; 404 `not_found` |

- **Data:** `wpcampaigns` plus `wpcampaign_contacts` (status, clicked flag, response).
- **Rules & edge cases:**
  1. `data` comes from cached counters; `meta.counts` is computed live from recipient rows: sent = not pending and not failed; delivered = delivered or read; read; failed; clicked flag; responded = has a response.
  2. QUIRK: for recurring campaigns the live set is limited to today, so `meta.counts` shows today only while `data.counts` is all-time. The date range filters the app supports cannot be passed.
  3. QUIRK: `meta.metrics` are unrounded percentages whereas `data.metrics` are rounded to 2 decimals.
  4. QUIRK: any internal error is reported as 404 `not_found`.
  5. The per-contact list, segments, A/B stats, templates and flow details the internal call returns are dropped.
  6. All recipient rows are loaded in memory.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** API rate limit.
- **Acceptance criteria:**
  - Given a campaign with 4 recipients (1 failed, 1 read, 2 delivered), then `meta.counts.total` 4, `failed` 1, `read` 1, `delivered` 3.
  - Given a missing or foreign id, then 404 `not_found`.
  - Given zero sent, then `meta.metrics` are all 0.
  - Given a recurring campaign, then `meta.counts` reflects today only (document or fix).
- **Source refs:** routes/api/v1/campaigns.php; app/Http/Controllers/Api/V1/CampaignController.php (show); app/Http/Controllers/Api/App/CampaignController.php (show, resolveRange); app/Http/Resources/Api/V1/CampaignResource.php
- **Port notes:** `CampaignsReadService.detail` and `live` exist. Compute counts with SQL aggregates and make `data.counts` and `meta.counts` one source; drop the "today only" recurring behaviour or expose an explicit range parameter.

### WD-API-089 — Stop a campaign (POST campaigns/{id}/stop)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-088, WD-CAMP-016
- **Summary:** Marks a processing, scheduled or active campaign as stopped.
- **Actors & access:** API key; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                      | Route name            | Controller@action              | Middleware                             | Request | Response                                                                                            |
| ------------------------------- | --------------------- | ------------------------------ | -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| POST api/v1/campaigns/{id}/stop | api.v1.campaigns.stop | Api\V1\CampaignController@stop | api, auth.apikey, auth.apikey.throttle | none    | `{data: campaign}` (full list/detail shape, status `stopped`); 404 `not_found`; 422 `not_stoppable` |

- **Data:** updates `wpcampaigns.status` = `stopped`, `completed_at` = now.
- **Rules & edge cases:**
  1. Allowed from `processing`, `scheduled`, `active` only; any other status gives 422 "Only processing, scheduled, or active campaigns can be stopped."
  2. QUIRK: a freshly created immediate campaign has status `running`, which is not stoppable until it becomes `processing`.
  3. The Node schedule is not cancelled and pending recipient rows are not touched; the sweeper skips it because it is no longer scheduled.
  4. The web UI has separate cancel, resume and send-now actions that the API does not expose.
  5. Status change emits `campaign_status_updated`.
  6. Any internal failure is also reported as 422 `not_stoppable`.
- **Async & events:** outgoing webhook `campaign_status_updated`.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a scheduled campaign, when POST stop, then 200 with `data.status` `stopped` and `completed_at` set.
  - Given a completed campaign, then 422 `not_stoppable`.
  - Given a foreign id, then 404 `not_found`.
  - Given the campaign was stopped, then a later GET shows `stopped` and the sweeper does not fire it.
  - Given a webhook subscription for status updates, then one delivery is queued with the previous status.
- **Source refs:** routes/api/v1/campaigns.php; app/Http/Controllers/Api/V1/CampaignController.php (stop); app/Http/Controllers/Api/App/CampaignController.php (stop); app/Models/WpCampaign.php
- **Port notes:** `CampaignsActionsService.cancel` exists in the target; reuse it (it should also stop queued sends via the job queue). Align the allowed-from statuses to include `running`. Emit the event via the outbox.

### WD-API-090 — Delete a campaign (DELETE campaigns/{id})

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-088, WD-CAMP-018
- **Summary:** Hard-deletes a scheduled, failed or completed campaign together with its recipient rows.
- **Actors & access:** API key; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                   | Route name               | Controller@action                 | Middleware                             | Request | Response                                                               |
| ---------------------------- | ------------------------ | --------------------------------- | -------------------------------------- | ------- | ---------------------------------------------------------------------- |
| DELETE api/v1/campaigns/{id} | api.v1.campaigns.destroy | Api\V1\CampaignController@destroy | api, auth.apikey, auth.apikey.throttle | none    | `{data:{deleted:true, message}}`; 404 `not_found`; 422 `delete_failed` |

- **Data:** deletes `wpcampaign_contacts` rows then the `wpcampaigns` row.
- **Rules & edge cases:**
  1. Allowed statuses: scheduled, failed, completed. Running, processing, active, stopped and draft are refused with 422 "Only scheduled, failed, or completed campaigns can be deleted"; QUIRK: a stopped campaign cannot be deleted through the API.
  2. The Node schedule is not cancelled, so a scheduled campaign may leave an orphan schedule on Node.
  3. The plan quota ledger is not decremented (delete-proof by design).
  4. No `campaign_deleted` webhook exists.
  5. `data` carries a nested message string.
  6. Bulk delete exists in the app controller but has no v1 route.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a completed campaign, when DELETE, then 200 `deleted: true` and a later GET returns 404.
  - Given a running campaign, then 422 `delete_failed` and nothing is deleted.
  - Given a foreign id, then 404 `not_found`.
  - Given a deleted campaign, then creating a new one still counts against `total_campaigns_limit`.
- **Source refs:** routes/api/v1/campaigns.php; app/Http/Controllers/Api/V1/CampaignController.php (destroy); app/Http/Controllers/Api/App/CampaignController.php (destroy); app/Models/WpCampaign.php
- **Port notes:** `CampaignsActionsService.remove` exists. Decide whether stopped campaigns may be deleted (recommended yes) and cancel queued jobs on delete. Cascade recipient rows via FK or inside the same transaction.

### WD-API-091 — Schedule a one-off message (POST scheduled)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-SCHED-003, WD-SCHED-010, WD-SCHED-029
- **Summary:** Schedules a text or template message to a list of raw phone numbers at a future time. The row is only saved; the Node scheduler picks it up later.
- **Actors & access:** API key; workspace scoped. No plan feature gate, no limit check and no wallet check at scheduling time (QUIRK, the web UI enforces WD-SCHED-019 gates).
- **UX & screens:** none.
- **Endpoints:**

| Method uri            | Route name             | Controller@action                | Middleware                             | Request                                                                                                                                                                                                                                                                            | Response                                                                                                   |
| --------------------- | ---------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST api/v1/scheduled | api.v1.scheduled.store | Api\V1\ScheduledController@store | api, auth.apikey, auth.apikey.throttle | `name` (required, max 255); `message` (required without template_id, max 4096); `template_id` (nullable integer); `device_id` (nullable integer); `recipients` (required array, min 1, each string max 32); `run_at` (required string max 64); `timezone` (nullable string max 64) | 201 `{data: scheduled}`; 404 `template_not_found`; 422 `schedule_failed` (with `details` for field errors) |

- **Data:** inserts `scheduled_messages`: name and message encrypted, `template_type` text or template, schedule type `once`, recipient type `number`, numbers stored encrypted as digits only, `total_recipients`, `scheduled_time` and `next_run_at` in UTC, send date/time in the schedule zone, `timezone`, `from_number`, status `scheduled`, provider Baileys when a device was resolved else the workspace default engine. Response (scheduled): id, name, type, status, message, template_id, device_id, recipient_count, run_at (ISO-8601), next_run_at, timezone, total_sent, total_delivered, total_failed, created_at. Phone numbers are never returned.
- **Rules & edge cases:**
  1. A template id must be visible to the workspace, else 404 `template_not_found` (note 404 here versus 422 on broadcasts).
  2. Zone used = request, else workspace, else key owner's, else app default; `run_at` is parsed in that zone and stored as UTC. It must be at least one minute in the future ("send_at must be at least 1 minute in the future") and must be parseable; both are 422 `schedule_failed`.
  3. Recipients are reduced to digits, empty ones dropped, duplicates removed; none left gives 422 "No valid recipient numbers." No minimum length, and no opt-out filtering or contact lookup (QUIRK).
  4. Sender: `device_id` must belong to the workspace; otherwise (or when omitted) the most recent connected device is used; if none exists the row is saved with a null device and still returns 201 (will never send) (QUIRK).
  5. A template id makes the type `template` and wins over `message`. Only one-off sends are possible; recurring, media, location, group and queue targets exist in the model but not through the API.
  6. Inner validation errors are returned as 422 `schedule_failed` with `details`; outer validation errors depend on the JSON/redirect rendering (WD-API-007).
  7. No Node call is made at creation; registration happens through Node's active-schedule sync or the web scheduler, so `node_schedule_id` is empty initially.
- **Async & events:** none at creation; later Node fire and status callbacks (WD-SCHED-023/024) update totals and status.
- **External systems:** Node scheduler (indirect).
- **Settings:** workspace timezone, API rate limit.
- **Acceptance criteria:**
  - Given a body with `name`, `message`, one recipient and `run_at` ten minutes ahead, then 201, `data.status` `scheduled`, `recipient_count` 1 and `run_at` equal to that moment in UTC.
  - Given `run_at` 30 seconds ahead, then 422 `schedule_failed` with the one-minute message.
  - Given `run_at` of "2026-12-01 09:00" and `timezone` `Asia/Kolkata`, then `run_at` in the response is 03:30 UTC.
  - Given a template id of another workspace, then 404 `template_not_found`.
  - Given neither `message` nor `template_id`, then validation error.
  - Given recipients `["+91 98765-43210", "919876543210"]`, then `recipient_count` is 1.
  - Given a workspace with no connected device and no `device_id`, then 201 with `device_id` null.
- **Source refs:** routes/api/v1/scheduled.php; app/Http/Controllers/Api/V1/ScheduledController.php (store); app/Http/Requests/Api/V1/Scheduled/StoreScheduledRequest.php; app/Http/Resources/Api/V1/ScheduledResource.php; app/Http/Controllers/Api/App/QueueController.php (scheduleMessage, resolveQueueDeviceId); app/Models/ScheduledMessage.php
- **Port notes:** `modules/scheduled-queue-warmer` `ScheduleCreateService.create(input)` takes ctx org and (nullable) user, enforces `scheduled_messages` plan feature and usage, send guard, wallet precheck and warmer budget, requires a two-minute lead and a resolvable sender; none of that depends on RBAC grants, so it is usable by an api key. It is not exported from the barrel or module (only `SchedulerService`, `WarmerService`, `ScheduleProducerService` are). The target is stricter than WaDesk here, which is intended: keep the plan gates and make an unresolvable sender a 422. Contract `createScheduleInputSchema` is internal; map public `recipients` (numbers) and `run_at` + `timezone` and use uuids. Use `ScheduleProducerService` semantics for registration, not an in-memory Node store.

### WD-API-092 — List scheduled messages (GET scheduled)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-SCHED-001
- **Summary:** Lists the workspace's scheduled messages, newest created first.
- **Actors & access:** API key; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri           | Route name             | Controller@action                | Middleware                             | Request                                   | Response                           |
| -------------------- | ---------------------- | -------------------------------- | -------------------------------------- | ----------------------------------------- | ---------------------------------- |
| GET api/v1/scheduled | api.v1.scheduled.index | Api\V1\ScheduledController@index | api, auth.apikey, auth.apikey.throttle | `limit` (int, default 50, clamped 1..200) | `{data:[scheduled], meta:{count}}` |

- **Data:** reads `scheduled_messages` for the workspace; soft-deleted rows are excluded.
- **Rules & edge cases:**
  1. No status filter and no paging beyond `limit`.
  2. Includes every schedule of the workspace, not only API-created ones (recurring, media, location, group and queue schedules from the web UI and the mobile app); for those `message` can be null and `type` can be media or location.
  3. `run_at` is the first scheduled time; for recurring ones the next fire is `next_run_at`.
  4. Engine scope not applied.
  5. Cancelled rows remain in the list.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 schedules, then `data` has 3 items newest first and `meta.count` 3.
  - Given `limit=1`, then one item.
  - Given `limit=999`, then at most 200 items.
  - Given another workspace's schedules, then none are returned.
  - Given a cancelled schedule, then it is still listed with `status` `cancelled`.
- **Source refs:** routes/api/v1/scheduled.php; app/Http/Controllers/Api/V1/ScheduledController.php (index); app/Http/Resources/Api/V1/ScheduledResource.php; app/Models/ScheduledMessage.php
- **Port notes:** `ScheduleReadService.list` exists (not exported). Add a `status` filter and cursor pagination; keep phone numbers out of the response.

### WD-API-093 — Read one scheduled message (GET scheduled/{id})

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-092, WD-SCHED-012
- **Summary:** Returns one scheduled message with its status and delivery totals.
- **Actors & access:** API key; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                | Route name            | Controller@action               | Middleware                             | Request         | Response                                                            |
| ------------------------- | --------------------- | ------------------------------- | -------------------------------------- | --------------- | ------------------------------------------------------------------- |
| GET api/v1/scheduled/{id} | api.v1.scheduled.show | Api\V1\ScheduledController@show | api, auth.apikey, auth.apikey.throttle | path id numeric | `{data: scheduled}`; 404 `not_found` "Scheduled message not found." |

- **Data:** `scheduled_messages`: statuses scheduled, running, paused, completed, failed, cancelled; `total_sent`, `total_delivered`, `total_failed` updated by Node callbacks.
- **Rules & edge cases:**
  1. Soft-deleted or foreign rows give 404.
  2. QUIRK: failure reason and per-recipient outcomes are not exposed, so a failed schedule's cause cannot be read.
  3. Recipient numbers are never returned, only `recipient_count`.
  4. Timestamps are ISO-8601 with offset.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an existing schedule, then 200 with matching `name`, `message`, `run_at`, `timezone`.
  - Given a schedule that Node reported 3 sent, then `total_sent` is 3.
  - Given an unknown or foreign id, then 404 `not_found`.
  - Given a response, then no phone number appears anywhere in the body.
- **Source refs:** routes/api/v1/scheduled.php; app/Http/Controllers/Api/V1/ScheduledController.php (show); app/Http/Resources/Api/V1/ScheduledResource.php; app/Models/ScheduledMessage.php
- **Port notes:** `ScheduleReadService.detail` exists; project only the public fields; consider adding `failure_reason` (non-sensitive) as an improvement and say so in the contract.

### WD-API-094 — Cancel a scheduled message (DELETE scheduled/{id})

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-093, WD-SCHED-014
- **Summary:** Cancels a schedule that has not finished: the Node job is dropped (best effort) and the status becomes cancelled. The row is kept.
- **Actors & access:** API key; workspace scoped; no plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                   | Route name               | Controller@action                  | Middleware                             | Request | Response                                                                                                                   |
| ---------------------------- | ------------------------ | ---------------------------------- | -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| DELETE api/v1/scheduled/{id} | api.v1.scheduled.destroy | Api\V1\ScheduledController@destroy | api, auth.apikey, auth.apikey.throttle | none    | `{data: scheduled}` with `status` `cancelled`; 404 `not_found`; 422 `not_cancellable` "This schedule is already finished." |

- **Data:** updates `scheduled_messages.status` = `cancelled`.
- **Rules & edge cases:**
  1. Refused (422) when status is completed, cancelled or failed; scheduled, running and paused can be cancelled.
  2. If a Node schedule id exists and Node is configured, `DELETE /api/cancel-scheduled-message/{id}` is sent with the node token; the outcome is ignored, so a failed Node call still flips the local status.
  3. QUIRK: despite the verb the row is not deleted (the model supports soft delete but it is not used); a second DELETE returns 422, and the row still shows in the list.
  4. Messages already sent by a running schedule stay sent.
  5. No webhook, no wallet refund.
  6. A schedule with no Node id is only cancelled locally; Node's active-sync is expected to skip non-scheduled rows.
- **Async & events:** Node cancel call.
- **External systems:** Node scheduler cancel endpoint.
- **Settings:** Node server URL and token.
- **Acceptance criteria:**
  - Given a scheduled message, when DELETE, then 200 and `data.status` is `cancelled`.
  - Given a completed schedule, then 422 `not_cancellable`.
  - Given a cancelled schedule, when DELETE again, then 422 `not_cancellable`.
  - Given a foreign id, then 404 `not_found`.
  - Given a cancelled schedule, then a later GET still returns it with `cancelled` and it never fires.
- **Source refs:** routes/api/v1/scheduled.php; app/Http/Controllers/Api/V1/ScheduledController.php (destroy); app/Services/NodeSchedulerClient.php (cancel); app/Models/ScheduledMessage.php
- **Port notes:** `ScheduleActionsService.cancel` exists in the target (and `remove`); use cancel, which should remove the queued job via `ScheduleProducerService.cancel`. Decide whether the HTTP verb keeps its WaDesk meaning (cancel, row retained) or becomes `POST .../cancel`; keep WaDesk semantics for parity and note it in the contract.

### WD-API-095 — Campaign API recipient materialisation and sender-id translation

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-087, WD-CON-013, WD-CON-055, WD-WADEV-032
- **Summary:** Two behaviours inside campaign creation that deserve their own tests: how plain phone numbers become workspace contacts, and how the public `device_id` (an integer or a `cfg_<n>` string) is translated into the sender the campaign engine understands.
- **Actors & access:** same as WD-API-087.
- **UX & screens:** none.
- **Endpoints:** none of its own; part of POST api/v1/campaigns (see WD-API-087).
- **Data:** reads and inserts `contacts` (workspace, phone hash, name), reads `wa_provider_configs` and `devices`; writes campaign `device_id` and `provider`.
- **Rules & edge cases:**
  1. Each number has everything except digits and `+` removed, then only digits are kept; fewer than 8 digits are dropped silently; duplicates collapse.
  2. A number that matches an existing workspace contact by phone hash reuses it; otherwise a contact is created with the placeholder name "Recipient · " plus the last 4 digits. Unlike the mobile path, contact-created events are not suppressed.
  3. `device_id` that is digits only means an Unofficial (Baileys) device id and pins the campaign's provider to Baileys; `cfg_<n>` (also `cfg-<n>`, `cfg<n>`) is looked up among the workspace's Cloud API or Twilio configurations and becomes the composite sender `<provider>:<id>`.
  4. QUIRK: anything else (including the phone number the docs promise) or a `cfg_` id that is not in the workspace yields no device; the campaign is created with the workspace's default engine and no device.
  5. QUIRK: a bare numeric id is not verified against the workspace at creation.
  6. Cloud API and Twilio senders drop any custom buttons and quick replies.
- **Async & events:** contact creation may fire contact-created hooks and outgoing webhooks (WD-CON-052).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a number that already exists as a contact (different formatting), then no new contact is created and the campaign uses the existing one.
  - Given a new number `+1 415 555 0100`, then a contact exists afterwards with the placeholder name ending in `0100`.
  - Given `device_id` `cfg_4` that belongs to the workspace as a WABA config, then the campaign's sender is that config and its provider is `waba`.
  - Given `device_id` `cfg_999` not in the workspace, then 201 with a null `device_id` (parity) or 422 (recommended fix).
  - Given a number with 5 digits, then it is ignored.
- **Source refs:** app/Http/Controllers/Api/V1/CampaignController.php (store); app/Http/Controllers/WaCampaignsController.php (store, parseManualNumbers); app/Models/Contact.php (rememberPhone); app/Services/WorkspaceEngine.php (senderForKey)
- **Port notes:** use `ContactResolverService` / `ContactsService.create` (dedups by identity, no grants needed, already used by the public lead submit) to find or create contacts; resolve senders with the `SENDER_DIRECTORY` keys (`<engine>:<uuid>`). Public ids must be uuids, so `cfg_<n>` becomes a plain sender uuid; validate sender ownership and reject unknown senders with 422.

### WD-API-110 — Send one message (POST /messages): text, media, location

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** WD-API-005, WD-API-006, WD-API-007, WD-API-118, WD-API-119, WD-TIB1-042, WD-WADEV-032, WD-WALLET-009, WD-SCHED-009, WD-CON-048
- **Summary:** An API client sends one WhatsApp message (text, image, video, document, audio or location) to one number, synchronously, and receives the message id and its current status. The call reuses the in-app "quick send" pipeline: find or open the single thread for that number, record the message, hand it to the engine (Baileys/WABA through the Node bridge, or Twilio), then update the status. Scheduling is not reachable through v1.
- **Actors & access:** API key only (WD-API-005); per-key rate limit by plan (WD-API-006). Workspace comes from the key; the key's owner user is recorded as sender. No plan "API access" feature check and no key scopes check exist in v1 (the `scopes` column is never read). No consent, blocklist or 24-hour-window check.
- **UX & screens:** none.
- **Endpoints:**

| Method uri           | Route name            | Controller@action              | Middleware                             | Request                                                                                    | Response                                                                             |
| -------------------- | --------------------- | ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| POST api/v1/messages | api.v1.messages.store | Api\V1\MessageController@store | api, auth.apikey, auth.apikey.throttle | to, device_id, type, text, media (file), media_url, latitude, longitude; JSON or multipart | 201 `{data:{id,to,type,status,failure_reason,error_code,body,media_url,created_at}}` |

- **Data:** reads `api_keys`, `users`, `workspaces`, `devices`, `wa_provider_configs`, `contacts` (merge tags), `system_settings`, `messages`/`inbox_messages` (monthly count). Writes `conversations` (create or update preview/status/platform/provider/device/last_message_at/last_outbound_at/inbox_status), `messages` (one outbound row), `inbox_messages` (mirror row, deduped on source message id), `api_keys.last_used_at`, and the media disk when a file is attached. Encrypted at rest: message to/from number, body, failure_reason; conversation title, preview. Status values stored: pending then sent or failed.
- **Rules & edge cases:**
  1. Request rules: `to` required string max 32 (digits extracted; non-digit characters tolerated); `device_id` optional string max 40 (numbers coerced to strings before validation); `type` optional in text, image, video, document, audio, location (default text); `text` max 4096 (caption for media); `media` file max 16 MB; `media_url` valid URL max 2048; `latitude` -90..90; `longitude` -180..180. `from_number`, contact name and any scheduling fields are not accepted.
  2. Type inference: when `type` is text/absent and a `media` file or `media_url` is present, the type is inferred from the file's sniffed MIME (image, video, audio, otherwise document); a `media_url` alone infers image. An explicit non-text type is respected.
  3. Media types with neither file nor `media_url`: 422 `media_required`.
  4. Location needs both coordinates; text defaults to a single space. QUIRK: a coordinate equal to 0 counts as missing. QUIRK: lat+lng present turns any send into a location pin regardless of `type`.
  5. Recipient digits are extracted; if none remain the send fails ("Invalid recipient number").
  6. The sender is resolved per WD-API-118; if it resolves to a non-WhatsApp channel the send is rejected as `wrong_channel`.
  7. Thread: the existing conversation for that number is reused (digits match across raw, `@s.whatsapp.net`, `@c.us`, `@lid`, any engine/device/origin); otherwise a new conversation is created with origin `quick`, status pending, title = the number (WD-TIB1-042). An existing thread is realigned to the engine/device of this send.
  8. Body merge tags `{{...}}` are resolved against the recipient contact (found by workspace + phone hash; contact, custom attributes, workspace, system order); unknown tags become empty, never literal braces; resolution happens before the empty check (WD-CON-048).
  9. Empty body with no media and no location: fails `empty_message`.
  10. Message row created direction out, status pending; engine-resolved provider is pinned on the row so the dispatcher honours the chosen engine instead of the workspace primary.
  11. Dispatch gates in order: monthly plan cap / wallet overflow (only when `wallet_billing_on_delivery` = 0; default 1 means billing happens later on delivery, so no credit error normally occurs, WD-WALLET-009), platform emergency halt, security guardrails (off/monitor/enforce), allowed send methods, provider resolution. Halt/guardrail/no-device/engine errors are NOT HTTP errors: the message is saved as `failed` with the reason (first 191 chars) and the API still answers 201.
  12. QUIRK: local-only results (no Node bridge URL configured, no Twilio credentials) count as success and the message is marked `sent` though nothing left the server.
  13. After dispatch the thread preview, last_message_at, status (sent/failed) and last_outbound_at are updated and an `inbox_messages` mirror row (direction out) is written so the Team Inbox shows it; inbox_status becomes open if blank. Mirror failures never fail the send.
  14. Response `to` is the raw input string (not normalised) and `body` is the raw input text (not the merge-resolved text). QUIRK: `failure_reason` and `error_code` are always null in this response even when status is `failed`; they appear only on later reads (WD-API-120).
  15. Inner failures are reported as 422 (or the inner status, e.g. 402 out of credits, 500) with code `send_failed`; QUIRK: `error.message` carries the inner machine code (`empty_message`, `invalid_media`, `media_fetch_failed`, `wrong_channel`, `out_of_credits`, or `Validation failed.`, `Invalid recipient number.`, `Failed to process message.`) not a sentence.
  16. Framework validation failures use the default 422 `{message, errors}` shape, not the API envelope (JSON clients); non-JSON clients are redirected. No idempotency key: a retry sends again.
- **Async & events:** fully synchronous; no queue. Node bridge call timeout 40 s (text) / 90 s (media); Twilio 10 s. No outbound webhook is emitted for the send; later delivery/read ticks arrive through engine callbacks and update the same `messages` row (WD-WABA-037, WD-NODE-038). Realtime inbox refresh happens through the mirror row.
- **External systems:** Node bridge (`/api/send-message`, `/api/send-media-message`, `/api/send-media-only`, `/api/send-location` per sender number; base URL from the primary provider config or setting `baileys_server_url`, else env SERVER_URL); Twilio Messages REST (basic auth; creds per workspace, else admin settings, else env; sandbox sender override). Meta Graph direct send exists in code but is unused; WABA goes through the bridge.
- **Settings:** `security.api_rate_limit_per_minute`, `platform.emergency_send_halt`, `security.wa_guardrails_mode`, `allowed_send_methods` (default baileys, waba, twilio), `default_send_method`, `baileys_server_url`, `wallet_billing_on_delivery` (default 1), `bsp_pay_per_message`, Twilio defaults; env SERVER_URL.
- **Acceptance criteria:**
  - Given a workspace with one connected device, When POST /messages with `{to, text}`, Then 201 with `data.id` an integer, `status` sent, `type` text, and a `messages` row (direction out, workspace's number as from) plus a mirrored inbox message exist.
  - Given a number that already has a thread, When two sends go to it (one via `+91 98123 45678` formatting, one as digits), Then both messages land in the same single conversation.
  - Given type image with no file and no media_url, When POST, Then 422 `error.code = media_required`.
  - Given only a body made of an unresolved merge tag, When POST, Then 422 `send_failed` with message `empty_message` and no message row is created.
  - Given no connected sender and no Node URL reachable, When POST, Then 201 with `status` failed (or sent for local-only) and `failure_reason` null in the response while GET /messages/{id} shows the stored reason.
  - Given a device_id that resolves to a Telegram sender, When POST, Then 422 `send_failed` / `wrong_channel`.
  - Given `latitude` 12.9 and `longitude` 77.6 with type text and no text, When POST, Then a location message is sent (media_type location).
  - Given an invalid `to` (more than 32 characters), When POST with JSON accept, Then 422 `{message, errors.to}`.
- **Source refs:** routes/api/v1/messages.php; app/Http/Controllers/Api/V1/MessageController.php (store); app/Http/Controllers/Api/V1/V1Controller.php; app/Http/Requests/Api/V1/SendMessageRequest.php; app/Http/Resources/Api/V1/MessageResource.php; app/Http/Controllers/Api/App/QuickMessageController.php (sendQuickMessage, findOrCreateQuickThread, refreshThread, mirrorOutboundToInbox, resolveMergeTags); app/Services/WhatsAppDispatcher.php (send, dispatch, resolveProvider, dispatchNode, buildNodeRequest, dispatchTwilio, guardMonthlyMessagesLimit); app/Services/OverflowBilling.php; app/Support/SendGate.php; app/Exceptions/PlanLimitReachedException.php; app/Services/Inbox/ConversationResolver.php; app/Models/Message.php; app/Models/Conversation.php.
- **Port notes:** No `POST` single-send exists in crm-platform. Build a new `@Public() @UseGuards(ApiKeyGuard)` controller in `apps/api/src/modules/public-api` (path `public/v1/messages`, `@RequirePlanFeature('public_api')`). Do not call `InboxThreadService` (needs `ctx.userId`/grants, not exported). Use the `CONVERSATIONS_FACADE` from `chat-conversations` (`openConversationFor`/`findThread` plus `enqueueOutbound`) with a bot/api sender kind (add an `api` kind to `MESSAGE_SENDER_KINDS` in contracts if you want it distinguishable; `OutboundService.enqueue` writes `senderUserId = ctx.userId` which is null for keys, acceptable). Contact -> thread needs a `ChannelsFacade.list` channel id plus `ContactResolverService` phone resolution; no public phone lookup helper exists. The target send is queued (worker sends), so decide whether to keep WaDesk's synchronous status (poll briefly) or return 202 `queued` and document the difference; plan limit, halt and window guards are raised inside enqueue. Contracts: reuse `sendMessageSchema` in `packages/contracts/src/chat-conversations/message.ts` for text and add a public request schema for media_url/location (new in `@crm/contracts`, never a class-validator DTO). Tenant scoping and RLS come from `db.tx`. Barrel gap: `chat-conversations/index.ts` exports the facade; confirm `OutboundService` stays internal. Responses use uuid, not integer ids (repo rule), so the integer-id contract becomes a deliberate divergence to record in the parity file.

---

### WD-API-111 — Message history list (GET /messages)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-API-120
- **Summary:** Returns the workspace's most recent messages, newest first, up to a caller-chosen limit. There is no paging beyond the limit.
- **Actors & access:** API key; rate limited. Read-only; no plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri          | Route name            | Controller@action              | Middleware                             | Request                            | Response                                |
| ------------------- | --------------------- | ------------------------------ | -------------------------------------- | ---------------------------------- | --------------------------------------- |
| GET api/v1/messages | api.v1.messages.index | Api\V1\MessageController@index | api, auth.apikey, auth.apikey.throttle | query `limit` (default 50, 1..200) | 200 `{data:[message...], meta:{count}}` |

- **Data:** reads `messages` joined by existence to `conversations.workspace_id`; soft-deleted messages excluded; ordering `created_at` descending (no id tiebreak).
- **Rules & edge cases:**
  1. `limit` is cast to integer, default 50, clamped to 1..200 (non-numeric or <1 becomes 1, above 200 becomes 200); no error for bad values.
  2. Tenant scope is through the conversation's workspace; messages with no conversation or in another workspace never appear; the message's own workspace column is ignored.
  3. Both inbound and outbound messages are returned and no direction field is exposed. QUIRK: for inbound rows `to` is the business number.
  4. QUIRK: only the `messages` table is read, so replies written only to the team-inbox table are not listed.
  5. No filters (contact, status, date, direction) and no offset/cursor, so history older than the newest 200 is reachable only through the conversation messages endpoint.
  6. Empty result returns `data: []` and `meta.count = 0`.
  7. Item shape and timestamp format per WD-API-120.
- **Async & events:** none. Updates `api_keys.last_used_at`.
- **External systems:** none.
- **Settings:** per-plan `api_rate_limit_per_minute`.
- **Acceptance criteria:**
  - Given 60 messages in the workspace, When GET /messages without params, Then `data` has 50 items newest first and `meta.count` = 50.
  - Given `limit=500`, When GET, Then at most 200 items; given `limit=0` or `limit=abc`, Then exactly 1 item (no error).
  - Given messages in another workspace, When GET with this workspace's key, Then none of them appear.
  - Given a soft-deleted message, When GET, Then it is absent.
  - Given no messages, When GET, Then 200 `{data:[], meta:{count:0}}`.
- **Source refs:** routes/api/v1/messages.php; app/Http/Controllers/Api/V1/MessageController.php (index); app/Http/Resources/Api/V1/MessageResource.php; app/Models/Message.php.
- **Port notes:** Nothing public exists. Query `messages` (chat-conversations schema) via a new read in `public-api` using `db.tx` (RLS provides tenant isolation, so the conversation-workspace subquery is unnecessary). Use `CONVERSATIONS_FACADE.listMessages` only per conversation; a workspace-wide recent list needs a new repository method. Target is uuid/cursor based: decide whether to keep `limit`-only semantics (recommended for parity) or add `cursor`; contract goes in `@crm/contracts`.

---

### WD-API-112 — Message status lookup (GET /messages/{id})

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-API-120
- **Summary:** Returns one message with its current delivery status, failure reason and Meta error code, so a client that sent via POST /messages can poll for sent, delivered, read or failed.
- **Actors & access:** API key; rate limited. Any message in the workspace is readable, whoever sent it.
- **UX & screens:** none.
- **Endpoints:**

| Method uri               | Route name           | Controller@action             | Middleware                             | Request          | Response                                |
| ------------------------ | -------------------- | ----------------------------- | -------------------------------------- | ---------------- | --------------------------------------- |
| GET api/v1/messages/{id} | api.v1.messages.show | Api\V1\MessageController@show | api, auth.apikey, auth.apikey.throttle | path id (digits) | 200 `{data:{message}}`; 404 `not_found` |

- **Data:** `messages` by primary key restricted by existence on `conversations.workspace_id`; soft-deleted rows excluded.
- **Rules & edge cases:**
  1. `{id}` must be digits; a non-numeric path is a framework 404 (not the error envelope).
  2. Unknown id, soft-deleted, message without conversation or in another workspace: 404 `{error:{code:"not_found", message:"Message not found."}}`.
  3. Status moves forward with engine callbacks: pending, sent, delivered, read, or failed. `delivered_at` and `read_at` are not exposed.
  4. `failure_reason` is the decrypted human text (for Meta, code plus description) and `error_code` is the typed Meta code from the message's meta JSON, null otherwise.
  5. QUIRK: inbound messages are readable by id too.
  6. QUIRK: `created_at` is serialised as UTC with microseconds and `Z`, unlike the `+00:00` form in the POST response (WD-API-120).
- **Async & events:** none (read-only).
- **External systems:** none.
- **Settings:** rate limit only.
- **Acceptance criteria:**
  - Given a message sent through POST /messages, When GET /messages/{id}, Then 200 with the same id, `to` digits, and the current status.
  - Given a failed send, When GET, Then `failure_reason` is a non-empty string (and `error_code` is set when Meta supplied one).
  - Given an id belonging to another workspace, When GET, Then 404 with code `not_found`.
  - Given `/messages/abc`, When GET, Then 404 (route constraint).
  - Given a delivery callback moved the message to delivered, When GET, Then `status` is `delivered`.
- **Source refs:** routes/api/v1/messages.php; app/Http/Controllers/Api/V1/MessageController.php (show); app/Http/Resources/Api/V1/MessageResource.php; app/Models/Message.php.
- **Port notes:** New public endpoint; id in the port should be the message uuid (repo rule: uuid-only responses), so the digits-only route becomes a uuid route and the parity file must record it. Read from `messages` under RLS; map status via the chat-conversations message status enum (check it has delivered/read; WD-CHAT-014 says delivery receipts are partial in WaDesk). `failure_reason` and typed error code need to exist on the target row (check `chat-conversations` message schema; add columns via add-migration if missing).

---

### WD-API-113 — Media upload for reuse (POST /media)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-005, WD-API-007, WD-SET-039
- **Summary:** Uploads a file once to the workspace media storage and returns a hosted URL, path, kind, MIME type and size. The URL can later be used as `media_url` when sending. Nothing is stored in the database.
- **Actors & access:** API key; rate limited; no plan or quota gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri        | Route name         | Controller@action            | Middleware                             | Request                | Response                                                             |
| ----------------- | ------------------ | ---------------------------- | -------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| POST api/v1/media | api.v1.media.store | Api\V1\MediaController@store | api, auth.apikey, auth.apikey.throttle | multipart field `file` | 201 `{data:{url,path,type,mime,size}}`; 422 `unsupported_media_type` |

- **Data:** writes only a file under `chat-media/` on the active media disk (local public disk or the configured cloud bucket). No table.
- **Rules & edge cases:**
  1. `file` required, must be an uploaded file, max 16 MB; otherwise framework 422 `{message, errors.file}`.
  2. Extension allowlist (client extension, lower-cased): jpg, jpeg, png, gif, webp, bmp, tiff; mp4, webm, mov, 3gp, mkv; pdf, doc, docx, xls, xlsx, ppt, pptx; txt, csv, rtf, zip; mp3, ogg, opus, m4a, aac, wav, amr. Blocklist (php family, htaccess, html/htm, svg, xml, xhtml, js/mjs, cgi, pl, py, sh, exe, bat, com, jsp, asp/aspx) is rejected first. Empty extension rejected.
  3. Sniffed (content) MIME must be on an allowlist (the matching image/video/audio/document/text/zip types, plus `application/octet-stream`); an empty sniffed MIME passes.
  4. Rejections return 422 (not 415) with code `unsupported_media_type` and message "This file type is not allowed.", "This file content is not allowed." or "The uploaded file is invalid."
  5. Stored name is server-generated (unix time, 24 random characters, allowlisted extension); the client file name is never kept.
  6. `type` = image/video/audio by sniffed MIME prefix, else document. QUIRK: an ogg audio sniffed as `video/ogg` or `application/ogg` is typed video or document.
  7. `url` is the permanent public URL from the storage driver (no signing/expiry); `path` is the disk key `chat-media/<name>`; `size` is bytes.
  8. QUIRK: no database row means uploaded files are never listed, quota-checked or cleaned up.
  9. QUIRK: handing this URL back as `media_url` on POST /messages triggers a re-download through the SSRF guard, which rejects private/LAN hosts (see WD-API-119); attaching the file directly avoids that.
  10. QUIRK: the same SecureUpload guard is used by flows, scheduled and auto-reply media, but NOT by the direct `media` upload on POST /messages.
- **Async & events:** none.
- **External systems:** cloud storage disk when enabled (S3-compatible per admin settings), else local.
- **Settings:** admin cloud-storage settings (WD-SET-039); PHP upload limits.
- **Acceptance criteria:**
  - Given a 1 MB PNG, When POST /media with `file`, Then 201 with `type` image, `mime` image/png, `size` equal to the byte length, `path` starting `chat-media/` and a fetchable `url`.
  - Given `shell.php` (or a file renamed `.html`/`.svg`), When POST, Then 422 `unsupported_media_type`.
  - Given a PDF over 16 MB, When POST, Then 422 with `errors.file`.
  - Given a `.jpg` whose bytes are an executable, When POST, Then 422 "This file content is not allowed.".
  - Given no `file` field, When POST with Accept JSON, Then 422 `errors.file`.
  - Given two uploads of the same file, When POST twice, Then two distinct paths.
- **Source refs:** routes/api/v1/messages.php; app/Http/Controllers/Api/V1/MediaController.php; app/Support/SecureUpload.php; app/Support/fc_helpers.php (media_disk, media_url).
- **Port notes:** No public upload exists. The staff inbox upload in `chat-conversations` produces a `mediaId` (not a URL); `sendMessageSchema` media kind takes that id. Decide in an ADR whether the public media endpoint reuses the inbox upload store (return media id plus URL) or a new bucket path. Reuse the repo's storage adapter and sniffing util if present; otherwise implement the extension+MIME allowlist above as a shared guard and apply it to BOTH this endpoint and the direct file on send (closing the WaDesk gap). Multipart body signing: `ApiKeyGuard` signs `rawBody`, check multipart works with HMAC (the raw bytes are signed) and set a Nest body-size limit of 16 MB for this route (see the body-limit work in INFRA).

---

### WD-API-114 — Conversation list (GET /conversations)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-TIB1-042, WD-TIB1-043
- **Summary:** Lists the workspace's chat threads, most recently active first, paginated, each with the contact number, display name, last message preview, last activity time, unread count, send status and channel code.
- **Actors & access:** API key; rate limited; read-only.
- **UX & screens:** none.
- **Endpoints:**

| Method uri               | Route name                 | Controller@action                   | Middleware                             | Request                         | Response                                                    |
| ------------------------ | -------------------------- | ----------------------------------- | -------------------------------------- | ------------------------------- | ----------------------------------------------------------- |
| GET api/v1/conversations | api.v1.conversations.index | Api\V1\ConversationController@index | api, auth.apikey, auth.apikey.throttle | `per_page` (25, 1..100), `page` | 200 `{data:[thread], meta:{page,per_page,total,last_page}}` |

- **Data:** reads `conversations` (workspace_id, origin, title, preview, raw_jid, last_message_at, unread_count, status, platform); title and preview decrypted. Order `last_message_at` desc then `id` desc. Thread: `id` integer; `contact` digits of the `raw_jid` part before `@` (null when no digits); `name` = title; `last_message` = preview; `last_message_at` ISO-8601 with offset, null if unset; `unread` integer (null as 0); `status` raw queue status; `channel` raw legacy platform code.
- **Rules & edge cases:**
  1. `per_page` int-cast default 25 clamp 1..100; `page` standard (default 1); `total` counted, `last_page` at least 1.
  2. Scope: workspace plus origin in chat, inbox, chatbot (campaign and bulk threads excluded).
  3. QUIRK: threads created by POST /messages for a brand-new number have origin `quick`, so they are NOT in this list even though the code comment claims quick sends share the inbox origin; they are reachable only by id.
  4. QUIRK: `status` is the send-queue status (pending, scheduled, sent, failed), not the inbox lifecycle (open/resolved/snoozed), which is not exposed.
  5. QUIRK: `channel` is the legacy engine code (`W` Baileys, `WB` WABA, `T` Twilio), not the conversation's channel column (telegram, instagram, ...).
  6. QUIRK: archived, spam, muted, pinned and snoozed threads are not filtered out.
  7. QUIRK: `contact` comes from `raw_jid` only; for LID threads it shows the LID digits, for non-phone channels flattened digits.
  8. No search, status or channel filters.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** rate limit only.
- **Acceptance criteria:**
  - Given 30 inbox threads, When GET /conversations, Then 25 items, `meta` `{page:1, per_page:25, total:30, last_page:2}`, ordered by last activity descending.
  - Given a thread with `raw_jid` `919812345678@s.whatsapp.net`, When GET, Then `contact` is `919812345678`.
  - Given `per_page=1000`, When GET, Then `meta.per_page` is 100.
  - Given a thread opened by POST /messages (origin quick) and nothing else, When GET, Then it is absent.
  - Given another workspace's threads, When GET, Then none returned.
- **Source refs:** routes/api/v1/messages.php; app/Http/Controllers/Api/V1/ConversationController.php (index, shape); app/Models/Conversation.php (scopeChatOnly, casts).
- **Port notes:** Do NOT reuse `InboxConversationsService` (needs `ctx.grants`/`ctx.userId!`, `InboxAccess.viewer()`; not usable by keys). Build an api-specific read on `ConversationsRepository` (exported) with an all-visible scope, or add a key-safe overload. Contract schema in `@crm/contracts` (reuse fields from `conversationSummarySchema` in `team-inbox-conversations/inbox.ts` selectively). The target has a real channel concept: expose `channel` as the channel kind (a deliberate improvement) and record the divergence; the quick-origin visibility quirk should be fixed (decide: include all non-campaign threads). uuid ids, cursor pagination (repo rule) versus WaDesk page/per_page: record as intended divergence or keep page params.

---

### WD-API-115 — Messages of one conversation (GET /conversations/{id}/messages)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-API-120, WD-API-114
- **Summary:** Returns one conversation's messages, newest first, paginated. Works for any conversation in the workspace, including ones hidden from the list endpoint.
- **Actors & access:** API key; rate limited; read-only. Does not mark the thread read.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                             | Route name                    | Controller@action                      | Middleware                             | Request                                           | Response                                                                                      |
| -------------------------------------- | ----------------------------- | -------------------------------------- | -------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET api/v1/conversations/{id}/messages | api.v1.conversations.messages | Api\V1\ConversationController@messages | api, auth.apikey, auth.apikey.throttle | path id (digits), `per_page` (50, 1..200), `page` | 200 `{data:[message], meta:{conversation_id,page,per_page,total,last_page}}`; 404 `not_found` |

- **Data:** `conversations` (id + workspace_id) then `messages` by conversation, ordered by id descending; soft-deleted excluded. Item shape per WD-API-120.
- **Rules & edge cases:**
  1. Unknown conversation or another workspace's: 404 code `not_found`, message "Conversation not found."
  2. `per_page` default 50, clamp 1..200; `page` standard.
  3. QUIRK: no origin filter, so quick, bulk and campaign threads are fetchable by id even though the list endpoint hides some.
  4. QUIRK: only `messages` rows are returned; team-inbox-only rows are missing.
  5. QUIRK: ordered by id, whereas GET /messages orders by created_at.
  6. Both directions included without a direction field.
  7. Legacy conversations with a null workspace are unreachable.
  8. `unread_count` is not reset by reading.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** rate limit only.
- **Acceptance criteria:**
  - Given a conversation with 120 messages, When GET with default params, Then 50 items, `meta.total` 120, `meta.last_page` 3, `meta.conversation_id` equal to the id, newest id first.
  - Given `per_page=300`, When GET, Then `meta.per_page` is 200.
  - Given another workspace's conversation id, When GET, Then 404 `not_found`.
  - Given a thread created by POST /messages (hidden from the list), When GET its id, Then 200 with that message.
  - Given a conversation with no messages, When GET, Then `data: []`, `meta.total` 0, `last_page` 1.
- **Source refs:** routes/api/v1/messages.php; app/Http/Controllers/Api/V1/ConversationController.php (messages); app/Http/Resources/Api/V1/MessageResource.php.
- **Port notes:** Use `CONVERSATIONS_FACADE.listMessages(conversationId, ListMessagesQuery)` (no grants dependency, usable by keys; the facade doc says the caller decides visibility, so tenant scoping via RLS plus an explicit conversation existence check). Contracts: `listMessagesQuerySchema` / `messageListResponseSchema` in `chat-conversations/message.ts`; the existing target pagination is cursor-based, so either map `page` to cursor or expose cursor and document the divergence. Do not call `InboxThreadService.listMessages` (user-bound, not exported).

---

### WD-API-116 — Device and channel list (GET /devices)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-WADEV-032, WD-WABA-022
- **Summary:** Lists every WhatsApp number the workspace owns: Unofficial (QR/Baileys) devices first, then connected-account rows for Meta WhatsApp Cloud and Twilio. Each row shows id, name, phone, engine label, status, active flag and last-seen time.
- **Actors & access:** API key; rate limited; read-only. No device-limit or plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri         | Route name           | Controller@action             | Middleware                             | Request | Response                            |
| ------------------ | -------------------- | ----------------------------- | -------------------------------------- | ------- | ----------------------------------- |
| GET api/v1/devices | api.v1.devices.index | Api\V1\DeviceController@index | api, auth.apikey, auth.apikey.throttle | none    | 200 `{data:[device], meta:{count}}` |

- **Data:** `devices` (workspace rows plus legacy null-workspace rows owned by the key's user; ordered active desc, id desc) then `wa_provider_configs` (provider waba or twilio; ordered is_primary desc, id desc). Device row: `id` integer; `name` decrypted device_name or ""; `phone` digits of country code plus number or ""; `engine` always `unofficial`; `status` raw (connected, disconnected, needs_pair, failed); `active` boolean; `last_seen_at` ISO-8601 or null. Config row: `id` string `cfg_<id>`; `name` display label, else verified name from meta, else capitalised provider; `phone` digits or null; `engine` `twilio` or `whatsapp_cloud`; `status` connected or disconnected (everything else collapsed); `active` = connected; `last_seen_at` = the connection time.
- **Rules & edge cases:**
  1. The two groups are concatenated, not interleaved; no pagination, no cap; `meta.count` is the total.
  2. Engine label mapping: baileys/unofficial/web become `unofficial`; wbiz/waba/wa_cloud/cloud/whatsapp_cloud become `whatsapp_cloud`; twilio stays; unknown non-empty becomes `unofficial`; empty becomes `unknown`. The API never exposes the underlying library name.
  3. QUIRK: ids are mixed type (integer for QR devices, `cfg_<n>` string for provider rows); `cfg_<n>` is the value to pass as `device_id` on send.
  4. QUIRK: `phone` is "" for devices but null for provider rows when absent.
  5. QUIRK: legacy rows may repeat the country code (plain concatenation, no de-dup).
  6. QUIRK: provider `last_seen_at` is the connect time, not a heartbeat.
  7. Other provider kinds (meta_ads, telegram, instagram, ...) are not listed.
  8. Proxy settings, warmer config and sent/failed counters are never exposed.
- **Async & events:** none (status changes are emitted elsewhere as `device_status_updated`).
- **External systems:** none (reads stored state; no live status probe).
- **Settings:** rate limit only.
- **Acceptance criteria:**
  - Given two QR devices (one connected, active) and one WABA config, When GET /devices, Then `data` has 3 rows, devices first (active first), the WABA row has id `cfg_<n>` and engine `whatsapp_cloud`, and `meta.count` is 3.
  - Given a Twilio config with status disconnected, When GET, Then its row shows `status` disconnected and `active` false.
  - Given a device with encrypted name and number, When GET, Then name and digits-only phone are plaintext in the response.
  - Given a workspace with no devices, When GET, Then `data: []` and `meta.count` 0.
  - Given another workspace's devices, When GET, Then none appear.
- **Source refs:** routes/api/v1/devices.php; app/Http/Controllers/Api/V1/DeviceController.php (index); app/Http/Resources/Api/V1/DeviceResource.php; app/Models/Device.php; app/Models/WaProviderConfig.php.
- **Port notes:** There is no staff or public "list senders" endpoint in crm-platform. Tables exist: `devices` (`schema/whatsapp-devices-baileys/tables.ts`) and `wa_provider_configs` (`schema/whatsapp-providers`). Options: `ChannelsFacade.list(tx, orgId)` from `chat-conversations` (exported, `ChannelSummary`) for the unified list, or `WabaConnectService.list()` plus a devices read; `DeviceControlService.status(orgId, deviceId)` in `node-bridge-runtime` gives a live status view if wanted. Sender keys are `<engine>:<uuid>` (`SENDER_DIRECTORY`); the port should return that key as the device id so it can be passed to POST /messages (replaces `cfg_<n>`), a deliberate uuid-based divergence. Gap: no public-ready service, so add a thin `public-api` read.

---

### WD-API-117 — Single device (GET /devices/{id})

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-API-116
- **Summary:** Returns one Unofficial (QR) device by its integer id in the same shape as the list row.
- **Actors & access:** API key; rate limited; read-only.
- **UX & screens:** none.
- **Endpoints:**

| Method uri              | Route name          | Controller@action            | Middleware                             | Request          | Response                               |
| ----------------------- | ------------------- | ---------------------------- | -------------------------------------- | ---------------- | -------------------------------------- |
| GET api/v1/devices/{id} | api.v1.devices.show | Api\V1\DeviceController@show | api, auth.apikey, auth.apikey.throttle | path id (digits) | 200 `{data:{device}}`; 404 `not_found` |

- **Data:** `devices` row visible to the workspace (workspace match, or legacy null-workspace row owned by the key's user). Same fields as the list device row; engine `unofficial`.
- **Rules & edge cases:**
  1. Unknown id, another workspace's device, or another user's legacy device: 404 `{error:{code:"not_found", message:"Device not found."}}`.
  2. Disconnected devices are returned normally; no status filter.
  3. QUIRK: provider rows from the list (`cfg_<n>`) cannot be fetched here: the route accepts digits only, and a bare number matching a provider-config id returns 404 unless a QR device with that id exists.
  4. QUIRK (cross-endpoint): on POST /messages a bare numeric `device_id` resolves first to a QR device and only then to a provider config, so numeric ids are ambiguous across the two tables (WD-API-118).
  5. Non-numeric path is a framework 404.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** rate limit only.
- **Acceptance criteria:**
  - Given a connected QR device, When GET /devices/{id}, Then 200 with matching id, plaintext name, digits phone, `engine` unofficial, `status` connected.
  - Given a device in another workspace, When GET its id, Then 404 `not_found`.
  - Given a disconnected device, When GET, Then 200 with `status` disconnected and `active` per its flag.
  - Given `/devices/cfg_5`, When GET, Then 404.
- **Source refs:** routes/api/v1/devices.php; app/Http/Controllers/Api/V1/DeviceController.php (show); app/Http/Resources/Api/V1/DeviceResource.php; app/Models/Device.php.
- **Port notes:** Same gap as WD-API-116. In the port, prefer one `GET devices/{uuid}` that resolves either a QR device or a provider connection (fixing the id-space split) via the same unified read; record as divergence. RLS replaces the legacy NULL-workspace fallback (drop it: the target has no orphan rows).

---

### WD-API-118 — Single-send sender resolution across devices and provider configs

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** WD-WADEV-032, WD-WADEV-030, WD-WABA-022
- **Summary:** Decides which number and engine a POST /messages send leaves from, based on the optional `device_id`, falling back to a sensible default so `{to, text}` alone works. The engine, from-number and provider pin all follow the chosen sender.
- **Actors & access:** applies to API-key sends (shared with the mobile quick-send). No separate endpoint.
- **UX & screens:** none.
- **Endpoints:** none of its own; used by `POST api/v1/messages` (WD-API-110).
- **Data:** reads `devices` and `wa_provider_configs` (and the unified sender directory for other channels); writes nothing itself.
- **Rules & edge cases:**
  1. `cfg_<n>` (also `cfg-<n>`, `cfg<n>`) or `waba|twilio|whatsapp_cloud|wbiz|cloud:<n>` selects a provider config in this workspace with provider waba or twilio, regardless of its connection status; engine = that provider, from = digits of its phone.
  2. `baileys:<id>` selects the QR device directly even if disconnected (an explicit pick stays the pick).
  3. Any other `engine:id` key (telegram, line, wechat, viber, sms, instagram, facebook, email) resolves through the sender directory (connected senders only) and returns that engine; POST /messages then rejects it as `wrong_channel`.
  4. A bare number is tried as a QR device id first, then as a provider-config id.
  5. With nothing explicit: newest connected QR device (connected status, active first, newest first); else the primary waba/twilio config, else the most recently connected waba/twilio config; else any QR device even disconnected; else the workspace default engine with no device and no from number.
  6. QUIRK: an unknown device_id or one belonging to another workspace is not an error; it falls through to the default sender.
  7. Phone for a QR device is digits of country code plus number.
  8. The resolved legacy platform code (W, WB, T) and engine are stamped on the thread and the message provider pin so the dispatcher routes by the picked engine instead of the workspace primary.
- **Async & events:** none.
- **External systems:** none directly (the dispatcher then calls the Node bridge or Twilio).
- **Settings:** `allowed_send_methods`, `default_send_method` (the engine fallback in step 5 and the dispatcher).
- **Acceptance criteria:**
  - Given a workspace with a connected QR device and a connected WABA config, When POST /messages without `device_id`, Then the message's from-number is the QR device's phone.
  - Given `device_id` `cfg_<id>` of a connected WABA config, When POST, Then the message provider is waba and from-number is that config's digits.
  - Given a workspace with only a disconnected QR device and a connected Twilio config, When POST without `device_id`, Then the send goes via Twilio.
  - Given `device_id` that does not exist in the workspace, When POST, Then the send still proceeds from the default sender (no 4xx).
  - Given `device_id` `telegram:<id>` of a connected Telegram sender, When POST, Then 422 `send_failed` / `wrong_channel`.
  - Given a bare numeric id matching both a QR device and a provider config, When POST, Then the QR device is used.
- **Source refs:** app/Http/Controllers/Api/App/QuickMessageController.php (resolveSender, findProviderConfig, configSender, fullPhone); app/Services/WorkspaceEngine.php (senderForKey, senders, enginesFor); app/Http/Requests/Api/V1/SendMessageRequest.php; app/Enums/WaProvider.php.
- **Port notes:** Use `SenderResolver.resolve` (`node-bridge-runtime/outbound/sender-resolver.service.ts`) and the `SENDER_DIRECTORY`/`SqlSenderDirectory` keys (`<engine>:<uuid>`), not a reimplementation. `SENDER_DIRECTORY` is provided per module (broadcasts, catalog, storefront), so `public-api` needs its own provider or an exported one. Decide whether an unknown `device_id` should be a 422/404 in the port (WaDesk silently falls back; a documented improvement).

---

### WD-API-119 — Single-send media intake: attached file or downloaded URL

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-113, WD-SET-039, WD-NODE-027
- **Summary:** For image, video, document and audio sends, the API accepts either a multipart file or a public URL that the server downloads, stores on the media disk and ships through the engine (inline base64 for the Node bridge, hosted URL for Twilio). The text becomes the caption.
- **Actors & access:** API key (via POST /messages).
- **UX & screens:** none.
- **Endpoints:** none of its own; part of `POST api/v1/messages` (WD-API-110).
- **Data:** writes a file to `chat-media/` on the media disk; `messages.media_path`, `messages.media_type` (image, video, document, audio, or location).
- **Rules & edge cases:**
  1. Attached file wins over `media_url` when both are sent. It is stored as `chat-media/<10 random chars>__<name with characters outside letters, digits, dot, underscore, dash replaced by underscore>`; the original name after the double underscore is later used as the document filename.
  2. The stored path passed on internally is limited to 255 characters; a very long client filename fails inner validation (`Validation failed.`).
  3. `media_url` download: scheme must be http or https; host resolved and rejected if private, loopback or reserved (SSRF guard); fixed User-Agent; 25-second timeout; non-2xx, empty body or body over 16 MB fail. Failures return 422 `send_failed` with message `media_fetch_failed` (QUIRK: the descriptive reason is in a field v1 drops).
  4. Kind: the declared type from the API; if absent, derived from the response Content-Type (image/, video/, audio/, else document). Stored name from the URL's last path segment, extension guessed from Content-Type (jpg, png, webp, gif, mp4, mp3, ogg, pdf) or `bin`.
  5. The media disk may be cloud; base64 is read back from it for the Node bridge with the real MIME; Twilio gets the hosted URL as MediaUrl.
  6. Response `media_url` is the hosted copy for uploads and downloaded URLs; the caller's own URL is echoed only if no stored copy exists.
  7. QUIRK: the direct `media` upload on POST /messages is not run through the extension/MIME allowlist (only size is limited); `POST /media` is.
  8. QUIRK: a hosted URL on a private/LAN address (for example from POST /media on an on-prem install) cannot be reused as `media_url` because of the SSRF guard.
  9. Media with caption goes to the media-with-caption endpoint, without caption to media-only.
- **Async & events:** none (synchronous download inside the request).
- **External systems:** the remote file host (HTTP GET), the media disk or cloud bucket, Node bridge, Twilio.
- **Settings:** cloud storage admin settings (WD-SET-039).
- **Acceptance criteria:**
  - Given a public image URL, When POST /messages with `{to, media_url}`, Then the type is inferred as image, a stored copy exists under `chat-media/`, and the response `media_url` points to our storage.
  - Given `media_url` of `http://127.0.0.1/x.png`, When POST, Then 422 `send_failed` / `media_fetch_failed` and no message row.
  - Given a URL returning HTTP 404, When POST, Then 422 `media_fetch_failed`.
  - Given a 20 MB multipart `media`, When POST, Then 422 framework validation on `media`.
  - Given a PDF file plus `text` "Invoice", When POST type document, Then the message has media_type document, body "Invoice" and it is sent as media with caption.
- **Source refs:** app/Http/Controllers/Api/V1/MessageController.php (store media branch); app/Http/Controllers/Api/App/QuickMessageController.php (fetchRemoteMediaToStorage, media_path handling); app/Services/WhatsAppDispatcher.php (buildNodeRequest media branch, dispatchTwilio); app/Support/fc_helpers.php (media_disk, media_url, media_storage).
- **Port notes:** Needs the shared media upload/storage service; the inbox upload path in `chat-conversations` yields a media id that `enqueueOutbound` content (`kind: media`) consumes, so for URL intake download into that store first (with an SSRF-safe fetcher: reuse the repo's existing guard if any, else add one) and then enqueue by media id. Apply the upload allowlist from WD-API-113 to the direct file too. Provider adapters (not the controller) handle base64 vs URL delivery (provider-adapter skill).

---

### WD-API-120 — Public message shape and status vocabulary

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-CHAT-013, WD-CHAT-014, WD-WABA-037, WD-NODE-038
- **Summary:** One resource shape (id, to, type, status, failure_reason, error_code, body, media_url, created_at) is used by the send response, the message list, the single-message read and the conversation messages. This entry captures how each field is derived and the status values a client can see.
- **Actors & access:** API key (via the four message endpoints).
- **UX & screens:** none.
- **Endpoints:** shared by `POST api/v1/messages`, `GET api/v1/messages`, `GET api/v1/messages/{id}`, `GET api/v1/conversations/{id}/messages`.
- **Data:** `messages`: id, to_number (decrypted), media_type, status, failure_reason (decrypted), meta.error_code, body (decrypted), media_path, created_at.
- **Rules & edge cases:**
  1. `id` is the integer row id; `to` is `to_number`; `type` is `media_type` or `text` when empty (values: text, image, video, document, audio, location, plus any other stored media type); `status` is the stored status (fallback `queued` only if null); `failure_reason` the decrypted text or null; `error_code` from the message meta JSON (Meta typed code) or null; `body` decrypted or null; `media_url` is the hosted URL of `media_path` or null; `created_at` the creation time.
  2. Status vocabulary stored: pending, scheduled, sent, delivered, read, failed. API sends only produce pending then sent or failed at request time; delivered/read arrive later from engine callbacks (WD-WABA-037, WD-NODE-038) and status moves forward only.
  3. QUIRK: `created_at` format differs by endpoint: the send response is ISO-8601 with a numeric offset; the read endpoints serialise a date object as UTC with microseconds and a trailing `Z`.
  4. QUIRK: the send response builds the shape from a plain array so `failure_reason` and `error_code` are always null there, and `to` and `body` are the raw inputs.
  5. QUIRK: no `direction` field, so inbound and outbound rows are indistinguishable; inbound `to` is the business number.
  6. QUIRK: media_url on the send response may be the caller's original URL when no stored copy exists; on reads it is always our hosted URL (or null).
  7. Encrypted-at-rest fields are decrypted in the app before output; undecryptable values are not specially handled here.
- **Async & events:** status changes are driven by delivery callbacks; this entry itself has none.
- **External systems:** storage URL helper for `media_url`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a message with a stored image, When GET /messages/{id}, Then `type` is image and `media_url` is a fetchable URL.
  - Given a message with no media, When GET, Then `type` is `text` and `media_url` is null.
  - Given a failed Meta send with error code 131047, When GET, Then `status` failed, `failure_reason` contains the description and `error_code` is 131047.
  - Given a delivery callback marks the message delivered then read, When GET after each, Then the status shows `delivered` then `read`.
  - Given a POST /messages that ended failed, When the response is read, Then `failure_reason` is null (documented quirk) and a follow-up GET shows the reason.
- **Source refs:** app/Http/Resources/Api/V1/MessageResource.php; app/Models/Message.php (casts, STATUSES); app/Http/Controllers/Api/V1/MessageController.php; app/Http/Controllers/Api/V1/ConversationController.php (messages).
- **Port notes:** Define one `publicMessageSchema` in `packages/contracts/src` (new, public-api folder) and one mapper in `apps/api/src/modules/public-api`; map the target message row (chat-conversations schema: content, status, errors, attachments) to these fields. uuid ids instead of integers (repo rule, record as divergence). Normalise `created_at` to one ISO-8601 form for all endpoints (intended improvement, record it). Confirm the target message status enum includes delivered, read and a failure reason plus typed error code; add them through the message-status work if missing.

### WD-API-140 — List webhooks (GET /webhooks)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007, WD-API-143
- **Summary:** An API client lists every outbound webhook endpoint registered for its workspace, together with the list of event names it may subscribe to. Secrets and delivery statistics are never exposed.
- **Actors & access:** API key (WD-API-005) then rate limit (WD-API-006). Workspace comes from the key. No plan feature gate and no role check on the API path (the INTG UI is admin-only and plan gated by `access_outbound_webhooks`; the API ignores both).
- **UX & screens:** none (API only; documented on the public docs page, WD-API-149).
- **Endpoints:**

| Method uri          | Route name            | Controller@action              | Middleware                                | Request | Response                                                                                |
| ------------------- | --------------------- | ------------------------------ | ----------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| GET api/v1/webhooks | api.v1.webhooks.index | Api\V1\WebhookController@index | api, AuthenticateApiKey, ApiPlanRateLimit | none    | 200 `{data:[WebhookResource], meta:{count, available_events:[17 names]}}`, newest first |

- **Data:** reads `webhooks`. Resource fields: `id`, `url` (decrypted), `events` (array, reindexed; empty array when stored value is not an array), `active` (bool of `status`), `created_at` (ISO-8601). Never returned: secret, name, environment, http_method, counters, last_* columns.
- **Rules & edge cases:**
  1. Visibility: rows whose `workspace_id` equals the key's workspace, plus legacy rows with NULL workspace and `user_id` equal to the key owner.
  2. Ordered by id descending; no pagination, no filters, no search.
  3. `meta.available_events` is the key list of the event catalogue (WD-API-143) in catalogue order.
  4. QUIRK: `name` can be set on create but is not returned by the resource.
  5. No rows -> `data: []`, `meta.count: 0`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** rate limit settings (WD-API-006).
- **Acceptance criteria:**
  - Given a workspace with two webhooks, when GET /webhooks, then 200 with both, newest first, and `meta.count` 2.
  - Given a webhook created with a secret, when listing, then no secret or name field appears in any item.
  - Given a webhook in another workspace, when listing, then it is absent.
  - Given no webhooks, then `data` is an empty array and `meta.available_events` still lists all 17 events.
  - Given a missing or revoked key, then 401 (WD-API-005).
- **Source refs:** routes/api/v1/webhooks.php, app/Http/Controllers/Api/V1/WebhookController.php, app/Http/Resources/Api/V1/WebhookResource.php, app/Models/Webhook.php (scopeForCurrentWorkspace)
- **Port notes:** `webhooks` table already exists in the target (secret encrypted, events jsonb, row_version) but no service exists. Home: `apps/api/src/modules/webhooks` (customer subscription module, not `webhook-fanout`, which is the operator Meta forwarder). Use uuid in responses per repo rules (WaDesk returns numeric ids; decide and document). Tenant scoping through RLS replaces the legacy NULL-workspace/user fallback, which should be dropped.

### WD-API-141 — Register a webhook (POST /webhooks)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M (<=1 week)
- **Depends on:** WD-API-005, WD-API-007, WD-API-143
- **Summary:** An API client registers an HTTPS-ish endpoint, optionally picks the events it wants (default all), an optional label and signing secret, and whether it starts active. The row is created immediately with no verification ping.
- **Actors & access:** API key. No plan feature gate, no limit check, no secret requirement on this path (all three are enforced only by the INTG UI). QUIRK: the API is a bypass of `access_outbound_webhooks`, `webhooks_limit` and `security.webhook_signature_required`; the port should decide whether to close this gap (recommended: enforce the same plan gate and cap, per plan keys `outbound_webhooks` and `webhooks`).
- **UX & screens:** none; documented body fields appear on the docs page.
- **Endpoints:**

| Method uri           | Route name            | Controller@action              | Middleware                                | Request                                                   | Response                           |
| -------------------- | --------------------- | ------------------------------ | ----------------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| POST api/v1/webhooks | api.v1.webhooks.store | Api\V1\WebhookController@store | api, AuthenticateApiKey, ApiPlanRateLimit | `url`, `events[]`, `name`, `secret`, `active` (see rules) | 201 `{data: WebhookResource}`; 422 |

- **Data:** writes `webhooks`: user_id = key owner, workspace_id = key workspace, name, environment fixed "Production", http_method fixed "POST", webhook_url (encrypted), events (encrypted JSON array), secret (encrypted, nullable), status = active flag. Counters start at zero.
- **Rules & edge cases:**
  1. `url`: required, valid URL per the framework `url` rule (not limited to https; ftp and similar schemes pass), max 2048.
  2. `events`: nullable array, each a string max 64. Values are NOT validated against the catalogue; unknown names are stored and simply never match. Omitted, null or empty array becomes `["*"]`. `["*"]` explicit is allowed and means all.
  3. `name`: nullable string max 191. `secret`: nullable string max 191 (stored encrypted; used as the HMAC key; never returned).
  4. `active`: nullable boolean (true/false/1/0/"1"/"0"), default true.
  5. No duplicate-URL check; the same URL may be registered many times and then receives each event once per row.
  6. No SSRF protection: loopback, private ranges, link-local and cloud metadata hosts are accepted. Deliveries later follow redirects. Flag for the port (block private ranges at registration and at send time, resolve DNS once).
  7. Validation failure uses the framework 422 shape (message + errors map) in WaDesk, not the `{error}` envelope; the port should use the unified envelope (WD-API-007) and record the intentional difference.
  8. The docblock claims "HTTPS endpoint" but nothing enforces it.
  9. Creating a webhook also writes a notification-log entry through the model's logging trait (INTG/notification domain).
- **Async & events:** none at creation; the new row is immediately eligible for events (WD-API-144).
- **External systems:** none.
- **Settings:** none on this path.
- **Acceptance criteria:**
  - Given a valid url only, when POST, then 201 with `events:["*"]`, `active:true`.
  - Given `events:["message_sent","contact_updated"]` and `active:false`, then the row is stored as given and does not receive events while inactive.
  - Given a url longer than 2048 chars or not a URL, then 422 naming `url`.
  - Given a secret of 192 chars, then 422 naming `secret`.
  - Given a secret supplied, then later deliveries carry a signature header (WD-API-146) and the response never echoes the secret.
  - Given `events:[]`, then stored as `["*"]`.
- **Source refs:** app/Http/Controllers/Api/V1/WebhookController.php (store), app/Http/Requests/Api/V1/Webhook/StoreWebhookRequest.php, app/Models/Webhook.php, database/migrations/2026_05_05_000009_create_webhooks_table.php, database/migrations/2026_05_19_120000_add_workspace_id_to_legacy_tables.php
- **Port notes:** Zod schema in `@crm/contracts`; reuse `webhooks` table; encrypt secret with the existing AES-GCM helper; emit audit + outbox in the same transaction per repo rules; honour plan caps `webhooks` (limit) and `outbound_webhooks` (feature) already in the catalogue; make `webhooks_limit` count the right table (the WaDesk UI counts `outbound_webhooks`, a bug, see INTG).

### WD-API-142 — Delete a webhook (DELETE /webhooks/{id})

- **Status:** implemented
- **Priority:** P1
- **Effort:** S (<=2 dev-days)
- **Depends on:** WD-API-005, WD-API-007
- **Summary:** An API client permanently removes one of its workspace's webhook endpoints; deliveries stop immediately.
- **Actors & access:** API key; workspace-scoped. No plan gate.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                  | Route name              | Controller@action                | Middleware                                | Request                | Response                                                            |
| --------------------------- | ----------------------- | -------------------------------- | ----------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| DELETE api/v1/webhooks/{id} | api.v1.webhooks.destroy | Api\V1\WebhookController@destroy | api, AuthenticateApiKey, ApiPlanRateLimit | path id (numeric only) | 200 `{data:{id, deleted:true}}`; 404 `{error:{code:not_found,...}}` |

- **Data:** hard-deletes the `webhooks` row. QUIRK: `webhook_deliveries` rows for it are not deleted (orphaned, still stored encrypted).
- **Rules & edge cases:**
  1. Non-numeric id: route does not match, plain 404 (framework).
  2. A webhook of another workspace is reported as not found (message "Webhook not found").
  3. Not idempotent: second delete returns 404.
  4. In-flight deliveries already started in the same request cycle may still complete.
  5. No update, pause or toggle endpoint exists in the API; changing anything requires delete + register (or the INTG UI). Candidate gap for the port (PATCH) but not WaDesk behavior.
- **Async & events:** none (no audit or notification in WaDesk; the port must add the audit entry).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an existing webhook, when DELETE, then 200 with `deleted:true` and it no longer appears in GET /webhooks.
  - Given the id belongs to another workspace, then 404 `not_found` and the other row survives.
  - Given deletion, when an event later fires, then nothing is posted to that URL.
  - Given the same DELETE repeated, then 404.
- **Source refs:** app/Http/Controllers/Api/V1/WebhookController.php (destroy), routes/api/v1/webhooks.php
- **Port notes:** hard delete is fine (repo rule); also delete or detach `webhook_deliveries` (partitioned by month, so prefer retention-based drop plus an on-delete filter). Add audit row.

### WD-API-143 — Event catalogue and subscription matching

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** A fixed catalogue of 17 subscribable event names with labels; a webhook subscribes to any subset or to everything with `*`. The catalogue is returned by GET /webhooks (`meta.available_events`) and drives the in-app UI picker.
- **Actors & access:** read-only constant; visible to any API key and to the INTG UI.
- **UX & screens:** INTG create/edit form lists these with labels; public docs page lists a 12-event subset (QUIRK, see WD-API-149).
- **Endpoints:** exposed via GET /webhooks meta (WD-API-140).
- **Data:** stored per webhook in `events` (encrypted JSON array).
- **Rules & edge cases:**
  1. Events and labels: message_received (inbound message received), message_sent, message_delivered, message_read, message_failed (outbound), broadcast_created, broadcast_status_updated, broadcast_message_status_updated (per recipient), campaign_created, campaign_status_updated, campaign_contact_status_updated, campaign_contact_clicked (link click), campaign_contact_replied, contact_created, contact_opt_in (also covers opt-out), contact_updated, device_status_updated.
  2. Matching is exact string equality or the wildcard `*`; no prefix or glob patterns.
  3. `test_fire` is an internal event used by the UI test button; it is not in the catalogue and cannot be subscribed to.
  4. Subscription values are not validated against the catalogue by the API (WD-API-141) but the UI constrains them.
  5. QUIRK: the request docblock listing events omits contact_created; the public docs page omits five events (broadcast_created, broadcast_message_status_updated, campaign_created, campaign_contact_status_updated, contact_created).
  6. The inbox `OutboundWebhookDispatcher` events (`conversation.assigned`, `conversation.resolved`, `conversation.replied`, ...) are a separate subsystem (`outbound_webhooks` table) and are not part of this catalogue.
- **Async & events:** n/a.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given GET /webhooks, then `meta.available_events` has exactly these 17 names in this order.
  - Given a webhook subscribed to `["message_sent"]`, when message_read fires, then it is not delivered.
  - Given a webhook subscribed to `["*"]`, then every catalogue event is delivered.
  - Given a webhook subscribed to an unknown name, then no event ever matches it and nothing errors.
- **Source refs:** app/Services/WebhookService.php (availableEvents, dispatch), app/Http/Requests/Api/V1/Webhook/StoreWebhookRequest.php, resources/views/developers/docs.blade.php
- **Port notes:** put the catalogue in `@crm/contracts` as an enum; `webhooks/webhook-events.ts` in broadcasts already uses WaDesk names (`MESSAGE_EVENTS`). Map each to target outbox event types (contact.created/updated, broadcast.message_status, device.status_changed, ...). Fix the docs/code mismatch by generating the docs list from the enum.

### WD-API-144 — Event emit and dispatch pipeline (recipient selection, deferral, failure isolation)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-143
- **Summary:** Domain code calls `emit` (deferred until after the HTTP response) or `dispatch` (inline) with an event name and a data array. The pipeline finds the active webhooks of that workspace subscribed to the event and delivers a signed payload to each. A webhook failure never breaks the operation that triggered it.
- **Actors & access:** internal service; no actor.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** reads `webhooks` (status true), writes via WD-API-147/148.
- **Rules & edge cases:**
  1. `emit` runs the work in the application's terminating callback so a slow subscriber never delays the user request or a Node callback; any exception is caught and logged as a warning only. If deferral is unavailable (CLI), it runs inline, still guarded. This is used from model lifecycle hooks, where an exception would otherwise abort the save.
  2. `dispatch` runs synchronously in the caller and is not wrapped in a catch (callers: status callbacks, link redirect, template sends; TemplateSender bulk path wraps it itself). A slow endpoint can therefore delay those requests (up to 3 attempts x 10 s plus backoff).
  3. Recipient selection: workspace id from `data.workspace_id`; candidates are active hooks of that workspace, plus legacy NULL-workspace hooks of the event's user. With no workspace id the pipeline falls back to hooks of the user id (explicit argument, else `data.user_id`); with neither it does nothing.
  4. A hook is delivered the event only if its events include the name or `*`.
  5. The payload is built once per dispatch (same payload id across all hooks) and each hook is delivered sequentially in the same process.
  6. Model hooks fire only on real changes (status transitions use "was changed" checks); bulk imports and mass UPDATE statements bypass hooks, so call sites emit explicitly (see WD-API-145). Single-contact paths emit, bulk CSV import deliberately does not (avoid a storm).
  7. No queue, no scheduler, no ordering guarantee, no dedupe, no per-workspace throttle of outbound traffic.
- **Async & events:** deferred execution after response; no BullMQ in WaDesk.
- **External systems:** the subscribers' endpoints.
- **Settings:** none (the `security.webhook_replay_window_sec` setting exists but is unused).
- **Acceptance criteria:**
  - Given an active subscribed hook, when a contact is created through the API, then a POST reaches the URL after the API response has been sent.
  - Given the subscriber endpoint hangs, when the triggering save runs, then the save and its response succeed.
  - Given a paused hook (`active:false`), then it receives nothing.
  - Given an event whose data has no workspace id and no user id, then nobody receives it.
  - Given two hooks in the same workspace both subscribed, then both are delivered with the same payload id.
- **Source refs:** app/Services/WebhookService.php (emit, dispatch), app/Models/WpCampaign.php, app/Models/Broadcast.php, app/Models/Device.php
- **Port notes:** the target already has a transactional outbox (`kernel/outbox/outbox.service.ts`, `OutboxSubscriberRegistry`). Implement as an outbox subscriber that enqueues a BullMQ delivery job per matching hook; this replaces the inline/deferred split, gives proper retries and isolates slow endpoints (worker job, not API process). Keep recipient rule "all active hooks in the org".

### WD-API-145 — Event producers per domain (which event fires from where, with which data)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L (spans many domains; each emitter is small)
- **Depends on:** WD-API-144
- **Summary:** Each catalogue event is raised by a specific place in WaDesk. This entry is the authoritative map so each owning domain wires its emitter during its own port. All payloads carry `workspace_id`; most carry `user_id` and a unix `timestamp` inside `data`.
- **Actors & access:** system.
- **UX & screens:** none.
- **Endpoints:** none (emitters live in Node callback controllers, models and webhook receivers).
- **Data:** per event data keys below.
- **Rules & edge cases:**
  1. **Campaigns (CAMP):** `campaign_created` on model create (id, name, type, status, schedule_type, total_recipients). `campaign_status_updated` on any status change (adds previous_status and the counts: total, sent, delivered, read, failed, responded). `campaign_contact_status_updated` from the Node status callbacks (two controller paths) and from the Meta status webhook when a campaign pivot row exists (campaign id/name, contact id, status, wamid, error message). `campaign_contact_replied` from the Node response callback (response text truncated to 4096). `campaign_contact_clicked` from the short-link redirect (broadcast/campaign/message/contact/template ids, phone, original url, token, click time, ip, user agent) only when the click row has a workspace; this event is dispatched inline and carries no `user_id`.
  2. **Broadcasts (BCST):** `broadcast_created` on create (id, name, template_id, status, total); `broadcast_status_updated` on status change (adds previous_status, success/delivered/read/fail counts). `broadcast_message_status_updated` per recipient from the Meta status webhook (ids, phone, wamid, status, error code/reason, aggregate counts); also raised inline.
  3. **Messages (INBOX/WABA):** `message_received` from the WABA/Twilio inbound handler (message id, conversation id, from number, body, media type, wamid, provider); the code comment says the Baileys path emits from its own inbound controller, which was not found as an emit in a grep (Open question). `message_sent` from template sends (single: template id/name, recipient, wamid, status, quality score; bulk per successful recipient), from the Node broadcast status callback, and from the Meta status webhook. `message_delivered`, `message_read`, `message_failed` from the Node broadcast status callback (broadcast data plus aggregate) and the Meta status webhook (message id, wamid, recipient, status, error code/title/reason, pricing, conversation).
  4. **Contacts (CON):** `contact_created` from the single-contact UI create and from the REST create endpoint (contact id, name, digits phone, email); bulk import silent. `contact_updated` from the UI edit only when something changed; QUIRK: the REST contact update endpoint does not emit it. `contact_opt_in` (opt in and opt out): UI edit when the unsubscribed flag toggles (opted_in bool, action subscribed/unsubscribed, source manual), and the campaign STOP-keyword callback on an actual transition (source stop_keyword).
     3b. QUIRK: free-text/media sends through `POST /messages` were not traced to a `message_sent` emit; only template sends and status callbacks are.
  5. **Devices (DEV):** `device_status_updated` on model status change and explicitly from the heartbeat stale sweep (mass update bypasses hooks): device id, name, digits phone, status, previous_status.
  6. Every emitter passes an owner user id so legacy user-scoped hooks still match.
- **Async & events:** emit (deferred) for model hooks and Node callbacks; dispatch (inline) for status, click and template sends, as marked.
- **External systems:** Node bridge callbacks and Meta/Twilio status webhooks are the triggers.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a campaign whose status changes to completed, when the change is saved, then subscribers of campaign_status_updated receive previous_status and updated counts.
  - Given a Meta delivered status for a template message, then message_delivered is delivered with wamid and pricing data.
  - Given a contact is toggled to unsubscribed in the UI, then both contact_updated and contact_opt_in (opted_in false, action unsubscribed) fire.
  - Given a CSV import of 500 contacts, then no contact_created events fire.
  - Given a device flips from connected to disconnected, then device_status_updated carries both statuses.
- **Source refs:** app/Models/WpCampaign.php, app/Models/Broadcast.php, app/Models/Device.php, app/Http/Controllers/WaCampaignsController.php, app/Http/Controllers/BroadcastsController.php, app/Http/Controllers/WaWebhookController.php, app/Http/Controllers/LinkRedirectController.php, app/Http/Controllers/ContactsController.php, app/Http/Controllers/Api/V1/ContactController.php, app/Services/Waba/TemplateSender.php
- **Port notes:** broadcasts already pre-build WaDesk payloads (`broadcasts/webhook-events.ts`, `broadcast.message_status` outbox type); contacts, devices and templates already emit outbox types (`contact.created/updated`, `device.status_changed`). Task for each domain owner: map their outbox event to the catalogue name and payload keys above. Close the quirks deliberately (REST update emitting contact_updated is the sensible fix). The same-payload-id-across-hooks behavior can be per-delivery instead.

### WD-API-146 — Delivery envelope, HMAC signing and brand-prefixed headers

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-API-144
- **Summary:** Every delivery is a JSON POST with a fixed envelope. When the webhook has a secret, a hex HMAC-SHA256 of the body is sent in a brand-prefixed header so white-label deployments never show the product name.
- **Actors & access:** system.
- **UX & screens:** the header name is shown on the docs page and in the generated OpenAPI text.
- **Endpoints:** outbound POST to the webhook url (always POST on real deliveries; the stored `http_method` is ignored).
- **Data:** payload stored in `webhook_deliveries.payload`.
- **Rules & edge cases:**
  1. Envelope: `id` (new uuid per dispatch), `event`, `eventType` (same value, legacy alias), `created` (ISO-8601 now), `timestamp` (unix; taken from the data's own `timestamp` when present), `data` (the whole event data incl. workspace_id, user_id).
  2. Headers: `Content-Type: application/json`; when the secret is non-empty, `<Prefix>-Signature` = lowercase hex HMAC-SHA256 over the JSON body string with the secret as key. No timestamp component, no `sha256=` prefix, no replay protection (`security.webhook_replay_window_sec` is stored but unused).
  3. Prefix rule: "X-" plus the brand (admin app name) with every non-alphanumeric character stripped; fallback "WaDesk" when empty. "Acme Corp" gives `X-AcmeCorp-Signature`. Helper methods also define `<Prefix>-Event` and `<Prefix>-Hook-Id`, but the customer webhook pipeline does NOT send them (only the inbox OutboundWebhookDispatcher does).
  4. QUIRK: the signature is computed over the JSON encoding of the payload array while the HTTP client encodes the body itself; they match only because both use default encoding. The port must sign the exact bytes sent.
  5. No secret means unsigned deliveries. Secrets are never logged or returned.
  6. The test button (`test_fire`) uses the same envelope; its data holds a hello message and the hook owner, with no workspace id.
- **Async & events:** n/a.
- **External systems:** subscriber's endpoint verifies the signature.
- **Settings:** brand name (General Settings app name); `security.webhook_signature_required` (default true) enforced only by the INTG UI.
- **Acceptance criteria:**
  - Given a hook with secret S and brand "Acme Corp", when an event is delivered, then header `X-AcmeCorp-Signature` equals HMAC-SHA256(body, S) in hex.
  - Given a hook without a secret, then no signature header is sent.
  - Given brand name consisting only of punctuation, then the header prefix is `X-WaDesk`.
  - Given any delivery, then the body contains `id`, `event`, `eventType`, `created`, `timestamp` and `data`.
- **Source refs:** app/Services/WebhookService.php (deliver, formatPayload, testFire), app/Support/Brand.php (webhookHeaderPrefix, webhookSignatureHeader, webhookEventHeader, webhookHookIdHeader)
- **Port notes:** keep envelope keys for compatibility (existing customer integrations). Strongly consider also sending event and delivery-id headers and a timestamp signature in addition (decision needed; parity requires the plain header). Brand comes from the org/platform branding setting.

### WD-API-147 — Delivery attempts: timeout, inline retries, health counters

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-API-146
- **Summary:** Each delivery makes up to three HTTP attempts with a 10-second timeout, retrying only transient failures, then records the outcome on the webhook row and in the delivery log.
- **Actors & access:** system.
- **UX & screens:** health state (active, paused, failing), success rate and last error are shown by the INTG UI.
- **Endpoints:** outbound only.
- **Data:** updates `webhooks`: last_fired_at, last_status_code, last_latency_ms, last_error, success_count, failure_count, is_failing. `retry_count` exists but is never written.
- **Rules & edge cases:**
  1. Attempts: max 3 (one try plus two retries); wait 400 ms before attempt 2 and 1200 ms before attempt 3, synchronously.
  2. Per-attempt timeout 10 s; redirects followed by the default HTTP client; TLS verification on.
  3. Success = any 2xx. Transient (retry) = no response/transport error or timeout, HTTP 429, any 5xx. Permanent (no retry) = every other status including other 4xx and unfollowed 3xx.
  4. After the final attempt: `last_error` null on success, otherwise the transport error text or "HTTP <code>" with " (after N attempts)" appended when more than one attempt ran. Latency is total elapsed time across attempts and sleeps.
  5. Counters: one success or failure increment per delivery (not per attempt). `is_failing` is set true only when this delivery failed and the (post-increment) total failure count is at least 3; a later successful delivery resets it to false. QUIRK: it is a total-failures threshold on the failing delivery, not consecutive failures.
  6. Failing endpoints are never auto-disabled, never alerted, never dead-lettered; they keep receiving events.
  7. Giving up after retries logs a warning with the webhook id.
- **Async & events:** synchronous inside the emit/dispatch call (no queue).
- **External systems:** subscriber endpoint.
- **Settings:** none (constants).
- **Acceptance criteria:**
  - Given an endpoint returning 500 twice then 200, when an event fires, then three attempts occur, the delivery is logged with attempts 3, success counter +1, `last_error` null.
  - Given an endpoint returning 404, then exactly one attempt, failure counter +1, `last_error` "HTTP 404".
  - Given an endpoint that times out on all attempts, then `last_error` ends with "(after 3 attempts)" and status_code is null.
  - Given a third failed delivery overall, then `is_failing` becomes true; a later 200 sets it false.
- **Source refs:** app/Services/WebhookService.php (deliver, MAX_ATTEMPTS, RETRY_BACKOFF_MS), app/Models/Webhook.php (state_label, success_rate)
- **Port notes:** implement as a BullMQ job with exponential backoff and a timeout; keep the same retry classification; replace sleeps with job delays. Consider (decision) consecutive-failure tracking and auto-pause, which WaDesk lacks; keep parity as the default.

### WD-API-148 — Delivery log (webhook_deliveries)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-API-147
- **Summary:** One row is written per delivery (not per attempt) with what was sent, what came back and how long it took. It is read by the in-app webhook detail page only; the REST API does not expose it.
- **Actors & access:** written by the system; read through INTG UI (admin role).
- **UX & screens:** INTG detail page: last 7 days, up to 2000 rows analysed, 40 shown; stats total, success %, p95 latency, retries, failures, 7-day success/failure chart. Dashboard widgets count deliveries (UserPagesController).
- **Endpoints:** none in the API.
- **Data:** `webhook_deliveries`: webhook_id, event_name, status_code (null on transport failure), latency_ms, is_retry (attempts > 1), attempts (default 1), payload (encrypted JSON string), response_body (encrypted, the full response, not truncated), error (transport error text), fired_at, timestamps. Index on webhook_id and fired_at.
- **Rules & edge cases:**
  1. A row is written even for failures; success is derived (status 200..299).
  2. QUIRK: no retention or pruning job exists (table grows unbounded) and deleting a webhook leaves its rows.
  3. Payload and response body are encrypted at rest; response bodies are stored in full and can be large.
  4. The test fire writes a row with event `test_fire`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a delivery that needed 2 attempts and succeeded, then one row exists with attempts 2, is_retry true, status_code 200.
  - Given a delivery with a connection error, then a row exists with null status_code and the error text.
  - Given a delivered payload, then reading the row returns the same JSON that was sent.
  - Given a deleted webhook, then its deliveries are no longer retrievable by tenant (port requirement; WaDesk orphans them).
- **Source refs:** app/Models/WebhookDelivery.php, app/Services/WebhookService.php (deliver), app/Http/Controllers/WebhooksController.php (show analytics), database/migrations/2026_05_05_000009_create_webhooks_table.php, database/migrations/2026_06_03_120000_add_attempts_to_webhook_deliveries.php
- **Port notes:** `webhook_deliveries` exists in the target, partitioned by month with PK (id, fired_at); retention is by dropping partitions (add a retention setting, truncate response_body to a cap). The viewing UI/endpoint belongs to INTG.

### WD-API-149 — Public developer docs page (/developers/docs, redirects /docs and /docs/api)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-API-150, WD-API-143
- **Summary:** A public, branded, search-filterable reference page for the customer API. Static introductory sections are server-rendered; the endpoint reference is built in the browser from the live OpenAPI document.
- **Actors & access:** anyone, no login, no plan or role check, not in the auth group; `noindex` meta. The "Get an API key" button links to /developers (which sends guests to login).
- **UX & screens:** `resources/views/developers/docs.blade.php` plus `public/js/api-docs.js` and `public/css/api-docs.css`. Top bar: brand mark, "<brand> API", version pill "v1", buttons "OpenAPI spec" (opens /docs/api.json in a new tab) and "Get an API key". Left sidebar: endpoint filter input, "Start here" links (Introduction, Authentication, Webhooks) and a script-built navigation by tag. Main: hero with base URL copy box (APP_URL + /api/v1, not the request host); "What you can do" with eight capability cards (send messages, receive messages, contacts and leads, templates, automation flows, delivery status, devices, account and usage); Authentication card (Bearer header with copy button, X-Api-Key alternative, workspace-scoped, hash-only storage, revocable); Webhooks card (explains JSON envelope, brand signature header, "Available events" grid of 12 events, a rate-limit line); endpoint reference area showing "Loading endpoints" until the script renders; footer line.
  - Events shown on the page (12): message_received, message_sent, message_delivered, message_read, message_failed, broadcast_status_updated, campaign_status_updated, campaign_contact_clicked, campaign_contact_replied, contact_opt_in, contact_updated, device_status_updated. QUIRK: the code catalogue has 17; the page omits five.
  - QUIRK: the rate-limit line still says no hard limit is enforced, while WD-API-006 enforces a default of 600 requests per minute. The port should render the real default.
  - Brand placeholders: the page title, hero, nav and footer use the admin-configured brand name; the signature header name comes from the same helper the sender uses, so docs always match what is sent.
  - The script: fetches the spec, groups operations by tag in a fixed order (Message, Template, Media, Contact, ContactGroup, Broadcast, Campaign, Scheduled, AutoReply, Flow, Device, Webhook, Deal, Conversation, Account), renders each endpoint with a parameter table, request-body rows, generated cURL, sample responses and a copy button; filter box hides non-matching endpoints. There is no in-page "try it" call.
  - Failure states: if the spec cannot be fetched the reference area stays on its loading text or shows the script's error (not traced).
- **Endpoints:**

| Method uri          | Route name      | Controller@action            | Middleware | Request | Response                |
| ------------------- | --------------- | ---------------------------- | ---------- | ------- | ----------------------- |
| GET developers/docs | developers.docs | route view `developers.docs` | web        | none    | HTML page               |
| GET docs/api        | none            | redirect closure             | web        | none    | 302 to /developers/docs |
| GET docs            | none            | redirect closure             | web        | none    | 302 to /developers/docs |

- **Data:** none stored; reads brand name setting and APP_URL.
- **Rules & edge cases:**
  1. Reachable without session in every environment (no restricted-access gate is configured).
  2. Base URL uses configured APP_URL; behind a proxy or white-label domain the displayed URL can differ from the domain being browsed.
  3. The page does not read the user's key and never prints one.
  4. QUIRK: docs text tells users to find keys under "More -> Developers / API" while the sidebar entry is labelled "REST API".
  5. External resources: Google Fonts stylesheet.
- **Async & events:** none.
- **External systems:** Google Fonts (CSS only).
- **Settings:** brand name (General Settings app name); APP_URL.
- **Acceptance criteria:**
  - Given a logged-out visitor, when opening /developers/docs, then the page renders (200) with the brand name and base URL.
  - Given /docs or /docs/api, then a redirect to /developers/docs.
  - Given brand "Acme Corp", then the Webhooks card shows `X-AcmeCorp-Signature`.
  - Given the spec loads, then each of the 15 tags appears in the sidebar in the fixed order and typing in the filter hides unmatched endpoints.
  - Given the page source, then it includes a noindex robots meta.
- **Source refs:** routes/web.php (L132-138), resources/views/developers/docs.blade.php, public/js/api-docs.js, public/css/api-docs.css, app/Support/Brand.php
- **Port notes:** build as a public Next.js route in `apps/web` (outside the authed layout) that renders from the generated spec; make the events grid and rate-limit text data-driven (enum + real default). No existing equivalent in the target.

### WD-API-150 — OpenAPI specification generation (/docs/api.json) and white-labelling

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** The machine-readable API description is generated at request time from the route, request-validation and resource classes, restricted to the customer API, then post-processed to carry the operator's brand and per-service overview text.
- **Actors & access:** public, no authentication; served through the web middleware group. The stock Scramble UI route is deliberately suppressed; only the JSON route is registered.
- **UX & screens:** consumed by WD-API-149 and by the "OpenAPI spec" button; machine clients can import it.
- **Endpoints:**

| Method uri        | Route name          | Controller@action                                  | Middleware | Request | Response       |
| ----------------- | ------------------- | -------------------------------------------------- | ---------- | ------- | -------------- |
| GET docs/api.json | scramble spec route | package closure (registered in AppServiceProvider) | web        | none    | OpenAPI 3 JSON |

- **Data:** none stored; generated document cached by the package under key `scramble.openapi` on the file cache store (invalidation on brand change not verified).
- **Rules & edge cases:**
  1. Scope: routes whose path starts with `api/v1`, excluding `api/v1/sheets-addon`. Security scheme is HTTP bearer, applied to routes carrying the API-key middleware.
  2. Info: title "<brand> API", version from env `API_VERSION` default v1, description "<brand> REST API ... send it as Authorization: Bearer ... Generate keys under Developers / API".
  3. Per-service overview text is added as root-level tags for Message, Template, Media, Contact, ContactGroup, Broadcast, Campaign, Scheduled, AutoReply, Flow, Device, Webhook, Deal, Conversation, Account (the Webhook overview mentions the HMAC-SHA256 signature header and real-time events). Tag names must equal the controller-derived operation tags.
  4. White-label: when the brand differs from "WaDesk", every string containing "WaDesk" inside paths and components (docblocks from request classes, e.g. the signature header text) is rewritten to the brand recursively. Skipped when the brand is "WaDesk".
  5. Request and response schemas come from the validation rules and resource classes, so docs are only as complete as those classes (e.g. the webhook request docblock omits contact_created).
  6. QUIRK: the request docblock in WaDesk hard-codes the header name `X-WaDesk-Signature`, fixed only by the brand rewrite.
  7. The spec has no examples; example bodies on the docs page are synthesized by the page script with built-in samples.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** brand name; env `API_VERSION`; package config (`api_path`, `export_path` api.json for the export command).
- **Acceptance criteria:**
  - Given a logged-out client, when GET /docs/api.json, then a valid OpenAPI document with `info.title` "<brand> API".
  - Given brand "Acme Corp", then no string "WaDesk" remains in paths or components.
  - Given the document, then it contains no `api/v1/sheets-addon` paths and every v1 operation has a bearer security requirement.
  - Given the document, then root `tags` lists the 15 services with descriptions.
  - Given a request schema change in code, then the next spec reflects it (after cache clear).
- **Source refs:** config/scramble.php, app/Providers/AppServiceProvider.php (L54-62, L160-250), routes/web.php (L134-138), composer.json (dedoc/scramble), app/Http/Requests/Api/V1/Webhook/StoreWebhookRequest.php
- **Port notes:** the target uses Zod contracts; generate OpenAPI from `@crm/contracts` (for example zod-to-openapi in a Nest `GET /docs/api.json` public controller, not a decorator-scrape). Brand comes from branding settings; tag overviews are static config. Ensure the endpoint is exempt from tenant auth but cache-safe and rate-limited at the edge.

### WD-API-151 — Developers console page (/developers) UX

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-API-001, WD-API-002, WD-API-003, WD-API-149
- **Summary:** A signed-in workspace member sees the REST API key console: reference info on the left, and on the right either the key creation form or the single active key, with a one-time banner right after creation and a copy-ready quickstart request. The key mint, list and revoke behaviors are specified in WD-API-001/002/003; this entry covers only the page.
- **Actors & access:** route middleware is only authentication (plus the global web stack). No role or plan middleware (QUIRK: the sidebar entry "REST API" is hidden for agents/managers, but the URL works for any workspace member; a plan feature key `public_api` exists in the target catalogue and should gate this in the port). Sidebar: group "Developer", tier admin, no feature key. Page nav-key is "more" (the page also appears under the More menu).
- **UX & screens:** `resources/views/user/developers/index.blade.php`, title "Developers / API". Two columns on large screens (260 px rail, fluid main); stacked on small screens.
  - Left rail, three cards. (a) Platform card: code icon, "Developer API", mono caption "REST - /api/v1", and a pill: "Key active" (green) when a non-revoked key exists, else "No key yet". (b) Quick reference card: "Base URL" showing APP_URL + /api/v1 in a truncated code box with a copy button (copies the text), and "Auth header" showing a dark box with `Authorization: Bearer <key>`. (c) Help card: "Need help?" text pointing to the full request and response reference with a "Read the docs" link to /developers/docs.
  - Title row: breadcrumb "More / Developers" (More links to /more), serif title "Developer API keys", paragraph explaining that a key lets you call the brand's REST API from your own apps, CRM or automation, and that there is one key per workspace. Buttons: "Back" (to /more) and "Open docs" (new tab to /developers/docs).
  - Error flash (coral box, icon): shown when the session carries `error`; used for the "already have an active key, revoke first" refusal.
  - One-time raw-key banner (mint green): only when the session carries the one-time key (flashed by the mint redirect). Title "Your new API key", warning that only a hash is kept and it will never be shown again, the raw key in a monospace box and a "Copy" button (copies the raw key). Reloading the page removes it permanently.
  - Active-key card (when a non-revoked key exists; revoked keys are never listed here): header "Your API key" with an "Active" pill; row with key icon, name (or "Untitled key"), prefix with ellipsis, "Created <Mon d, yyyy>", "Last used <relative time>" or "never"; a "Revoke" button that opens a confirm dialog titled "Revoke this key?" with the message that anything using it stops working immediately, cannot be undone, and a new key can be created afterwards, accept label "Revoke"; footer note "Only one key is allowed per workspace. Revoke this one to issue a new key."
  - Create form (when no active key): heading "Create your key", help text, field "Key name" (text, required, max 120, placeholder "e.g. Production backend", old value retained, inline coral validation error), button "Create key" with plus icon.
  - Quickstart card: heading, "Full reference" link (new tab), sentence "Send your first message - replace the key and recipient", and a dark code block with a cURL POST to `<base>/messages` with Bearer header and JSON body (to a sample number, type text, text "Hello from <brand>"). Not wired to the user's real key (placeholder YOUR_API_KEY); no copy button on the block in WaDesk.
  - Empty state = no active key (create form). There is no loading state (server rendered). Success flashes ("API key created...", "API key revoked...") arrive through the session `status` bag and are rendered by the layout.
  - A copy action swaps its icon briefly (script `user-developers-index`); the confirm dialog is the shared `data-confirm-form` component.
- **Endpoints:**

| Method uri                  | Route name                   | Controller@action              | Middleware | Request          | Response                                        |
| --------------------------- | ---------------------------- | ------------------------------ | ---------- | ---------------- | ----------------------------------------------- |
| GET developers              | user.developers              | DeveloperApiController@index   | web, auth  | none             | HTML with `keys` (workspace keys, newest first) |
| POST developers/keys        | user.developers.keys.store   | DeveloperApiController@store   | web, auth  | `name` (see 001) | redirect with one-time key flash or error flash |
| DELETE developers/keys/{id} | user.developers.keys.destroy | DeveloperApiController@destroy | web, auth  | path id          | redirect with status flash                      |

(Store/destroy rules belong to WD-API-001/003.)

- **Data:** reads `api_keys` of the current workspace (WD-API-002); only the first non-revoked key is shown. Reads brand name and APP_URL.
- **Rules & edge cases:**
  1. "Active" in the page means not revoked; an expired but unrevoked key still shows as Active (the API rejects it, WD-API-005). QUIRK.
  2. The raw key exists only in the flash for exactly one render; it is not stored and cannot be re-read.
  3. The page never exposes the hash; only name, prefix (first 12 chars of the key), created date, last used.
  4. Revoked keys disappear from the page; there is no history list.
  5. The base URL uses configured APP_URL, not the request host.
  6. With an active key the create form is not rendered at all, so the "one key" refusal flash appears only through stale/duplicate submissions.
  7. Last-used time is updated by every API call (WD-API-005), so the value is near real-time.
  8. Doubling submit of the create form is prevented only by the server one-key rule (second submit shows the error flash).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** brand name, APP_URL.
- **Acceptance criteria:**
  - Given a workspace with no key, when opening /developers, then the create form and the "No key yet" pill show and no active-key card.
  - Given a successful create, when redirected back, then the banner shows the full raw key once with a working Copy button, the active-key card shows the prefix, and after a reload the raw key is gone.
  - Given an active key, when clicking Revoke and confirming, then the card is replaced by the create form and the pill reads "No key yet".
  - Given an active key, when Revoke is clicked and the dialog cancelled, then nothing changes.
  - Given an empty or 121-char name, when submitting, then an inline validation error shows under the field and no key is created.
  - Given a guest, when requesting /developers, then redirect to login (with a return path).
  - Given a member with the agent role, when requesting the URL directly, then the page loads in WaDesk (record as a defect-to-decide for the port).
- **Source refs:** resources/views/user/developers/index.blade.php, app/Http/Controllers/DeveloperApiController.php, routes/web.php (L1833-1837), app/Support/UserNav.php (L267), public/js (page script `user-developers-index`)
- **Port notes:** build in `apps/web` under the settings/developer area in the owning domain's zone; data from WD-API-002's list endpoint; raw key shown from the mint response held in client state (not a flash). Add the permission/plan gate (`public_api` feature, admin tier) the original lacks. Keep copy and confirm interactions; make the quickstart use the real key only if the user just minted it (client state), otherwise placeholder.

## Data model

### `api_keys` (WaDesk)

Customer REST API keys, one workspace each. Columns: `id`; `workspace_id` (indexed); `user_id` (the member the key acts as, indexed); `name` (nullable, max 255 in
the table, 120 on the form); `key_hash` (sha256 hex of the raw key, unique); `prefix` (first 12 characters of the raw key, indexed, shown in the console);
`scopes` (json, null = full access, never read); `last_used_at` (written on every API call); `expires_at` (never set); `revoked_at` (soft revoke);
`created_by`; timestamps. No foreign keys: a force-deleted owner or workspace leaves orphan keys. The raw key is `wsk_` plus 40 random characters and is
returned once. Read by WD-API-002, written by WD-API-001 and WD-API-003, read and touched by WD-API-005, read by WD-API-006. Volume: one row per workspace
(live), a few revoked rows each.

### `webhooks` and `webhook_deliveries` (shared with the integrations domain)

Event subscriptions and their delivery log, read and written by WD-API-140 to 148. Columns that change behavior: `webhook_url` (encrypted), `secret`,
`events` (json list of catalogue names), `status` (active flag), failure and retry counters, last status code and latency; deliveries hold event name,
status code, latency, attempt count, payload and response body. Defined in detail by the integrations inventory; this domain consumes the same rows.

## Cross-domain contracts

- **Consumes** from `plans-subscriptions-trials`: entitlements, `api_rate_limit_per_minute`, `api_keys` limit, `public_api` and `access_sales_pipeline` features, usage meters (`/me`, `/usage`).
- **Consumes** from `auth-registration-security`: the platform setting `security.api_rate_limit_per_minute` and the secure-upload rules used by `/media` and template media.
- **Consumes** from each resource domain the same service its dashboard screen uses: contacts, groups, deals, templates, auto-replies, broadcasts, campaigns, scheduled sends, flows, devices, conversations and messages.
- **Consumes** from `wallet-message-billing` the owner's credits for `/usage` and the billing and credit checks inside sends.
- **Consumes** from `integrations-hubspot-slack-trello-google-webhooks` the webhook delivery pipeline and the in-app webhooks UI (cross reference only; this domain does not own those routes or views).
- **Exposes** to every resource domain the key authentication, the rate limit, the envelopes and the `wsk_` key model; the other domains own their business logic and tests, this domain owns the `/api/v1` routes, request validation and public response shapes.
- **Route ownership:** the contacts, deals, flows, templates and auto-reply inventories also list their `api/v1` routes. The route home is this domain (as `WD-FLR-009` states); those domains keep the business rules.
- **Shared with `extension` domain:** `api/v1/sheets-addon/*` is a different mechanism (Sheets add-on key) and is not part of this domain.

## Open questions & quirks

1. **One key per workspace** is hard-coded in WaDesk. The repo's plan seeds allow 1, 5 or 20 active keys (`api_keys` limit). Decision needed: set the limit to 1 on every plan (strict parity) or keep the seeded tiers (recorded as intended).
2. **Auth scheme.** WaDesk keys are plain bearer tokens. This repo already has a signed partner scheme (`Authorization: ApiKey <prefix>.<secret>` plus HMAC) for `/public/v1`. The port keeps both: bearer keys at `/api/v1`, signed keys unchanged.
3. **Ids and pagination.** WaDesk returns integer ids and page numbers; the platform rules require uuids and cursors. Documented as intended deviations; `per_page` is accepted as an alias of `limit`.
4. **Error and validation envelope.** WaDesk validation errors use Laravel's default shape and a 302 redirect without `Accept: application/json`. The port always returns 422 in the `{ error }` envelope (bug fix).
5. **No scope enforcement, no brute-force limit, no role check on the console, no audit of key mint or revoke, orphan keys after a user is force-deleted** (QUIRKS, WD-API-004, 005, 008, 010). The port hardens these and lists each as intended.
6. **Auto-reply create and update always answer 422** because the sender helper they call is not defined anywhere in the shipped code (WD-API-043). Reproduced as a documented blocked item until the owner decides whether to ship the working behavior.
7. **`POST /campaigns` returns the raw stored row**, so counts and metrics are always zero until the next read; broadcast `schedule_at` offsets and `timezone` are ignored; `POST /templates` never submits to Meta (WD-API-032, 080, 087).
8. **A rejected single send still returns 201** with `status: failed` and a null reason, and inner machine codes appear as `error.message` (WD-API-110).
9. **Docs page says "No hard request limit is enforced today"** while the real default is 600 per minute (WD-API-006, 149).
10. **Webhook events** the docs list but the code does not emit, and events emitted from paths not traced (see WD-API-145 and its open questions): `contact_updated` from the API, `message_received` from Baileys inbound, `message_sent` from `POST /messages`.
11. **Not run:** the reference app was not exercised by the entry writers; every behavior is from static reading and is verified later by `wadesk-playwright-parity`.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "DELETE api/v1/auto-replies/{id}",
    "DELETE api/v1/campaigns/{id}",
    "DELETE api/v1/contact-groups/{id}",
    "DELETE api/v1/contacts/{id}",
    "DELETE api/v1/deals/{id}",
    "DELETE api/v1/scheduled/{id}",
    "DELETE api/v1/templates/{id}",
    "DELETE api/v1/webhooks/{id}",
    "DELETE developers/keys/{id}",
    "GET api/v1/auto-replies",
    "GET api/v1/auto-replies/{id}",
    "GET api/v1/broadcasts",
    "GET api/v1/broadcasts/{id}",
    "GET api/v1/broadcasts/{id}/recipients",
    "GET api/v1/campaigns",
    "GET api/v1/campaigns/statistics",
    "GET api/v1/campaigns/{id}",
    "GET api/v1/contact-groups",
    "GET api/v1/contacts",
    "GET api/v1/contacts/{id}",
    "GET api/v1/conversations",
    "GET api/v1/conversations/{id}/messages",
    "GET api/v1/deals",
    "GET api/v1/deals/{id}",
    "GET api/v1/devices",
    "GET api/v1/devices/{id}",
    "GET api/v1/flows",
    "GET api/v1/flows/{id}",
    "GET api/v1/flows/{id}/subscribers",
    "GET api/v1/me",
    "GET api/v1/messages",
    "GET api/v1/messages/{id}",
    "GET api/v1/scheduled",
    "GET api/v1/scheduled/{id}",
    "GET api/v1/templates",
    "GET api/v1/templates/categories",
    "GET api/v1/templates/{id}",
    "GET api/v1/usage",
    "GET api/v1/webhooks",
    "GET developers",
    "GET developers/docs",
    "GET docs",
    "GET docs/api",
    "GET docs/api.json",
    "POST api/v1/auto-replies",
    "POST api/v1/broadcasts",
    "POST api/v1/broadcasts/{id}/stop",
    "POST api/v1/campaigns",
    "POST api/v1/campaigns/{id}/stop",
    "POST api/v1/contact-groups",
    "POST api/v1/contacts",
    "POST api/v1/deals",
    "POST api/v1/flows/{id}/enroll",
    "POST api/v1/media",
    "POST api/v1/messages",
    "POST api/v1/scheduled",
    "POST api/v1/templates",
    "POST api/v1/templates/{id}/send",
    "POST api/v1/webhooks",
    "POST developers/keys",
    "PUT api/v1/auto-replies/{id}",
    "PUT api/v1/contacts/{id}",
    "PUT api/v1/deals/{id}",
    "PUT api/v1/templates/{id}"
  ],
  "controllers": [
    "app/Http/Controllers/DeveloperApiController.php",
    "app/Http/Controllers/Api/V1/V1Controller.php",
    "app/Http/Controllers/Api/V1/AccountController.php",
    "app/Http/Controllers/Api/V1/AutoReplyController.php",
    "app/Http/Controllers/Api/V1/BroadcastController.php",
    "app/Http/Controllers/Api/V1/CampaignController.php",
    "app/Http/Controllers/Api/V1/ContactController.php",
    "app/Http/Controllers/Api/V1/ContactGroupController.php",
    "app/Http/Controllers/Api/V1/ConversationController.php",
    "app/Http/Controllers/Api/V1/DealController.php",
    "app/Http/Controllers/Api/V1/DeviceController.php",
    "app/Http/Controllers/Api/V1/FlowController.php",
    "app/Http/Controllers/Api/V1/MediaController.php",
    "app/Http/Controllers/Api/V1/MessageController.php",
    "app/Http/Controllers/Api/V1/ScheduledController.php",
    "app/Http/Controllers/Api/V1/TemplateController.php",
    "app/Http/Controllers/Api/V1/WebhookController.php"
  ],
  "services": [
    "app/Services/WebhookService.php",
    "app/Support/Brand.php",
    "app/Support/SecureUpload.php"
  ],
  "models": ["ApiKey", "Webhook", "WebhookDelivery"],
  "tables": ["api_keys", "webhooks", "webhook_deliveries"],
  "views": [
    "resources/views/developers/docs.blade.php",
    "resources/views/user/developers/index.blade.php"
  ],
  "middleware": [
    "app/Http/Middleware/AuthenticateApiKey.php",
    "app/Http/Middleware/ApiPlanRateLimit.php"
  ],
  "config_files": ["scramble.php"],
  "doc_pages": [
    "Documentation/pages/developer-guide/rest-api.html",
    "Documentation/pages/developer-guide/api-endpoints.html"
  ],
  "misc_files": [
    "app/Http/Requests/Api/V1/AutoReply/StoreAutoReplyRequest.php",
    "app/Http/Requests/Api/V1/AutoReply/UpdateAutoReplyRequest.php",
    "app/Http/Requests/Api/V1/Broadcast/StoreBroadcastRequest.php",
    "app/Http/Requests/Api/V1/Campaign/StoreCampaignRequest.php",
    "app/Http/Requests/Api/V1/Contact/StoreContactRequest.php",
    "app/Http/Requests/Api/V1/Contact/UpdateContactRequest.php",
    "app/Http/Requests/Api/V1/Flow/EnrollFlowRequest.php",
    "app/Http/Requests/Api/V1/Group/StoreContactGroupRequest.php",
    "app/Http/Requests/Api/V1/Scheduled/StoreScheduledRequest.php",
    "app/Http/Requests/Api/V1/SendMessageRequest.php",
    "app/Http/Requests/Api/V1/Template/StoreTemplateRequest.php",
    "app/Http/Requests/Api/V1/Template/UpdateTemplateRequest.php",
    "app/Http/Requests/Api/V1/Webhook/StoreWebhookRequest.php",
    "app/Http/Resources/Api/V1/AutoReplyResource.php",
    "app/Http/Resources/Api/V1/BroadcastResource.php",
    "app/Http/Resources/Api/V1/CampaignResource.php",
    "app/Http/Resources/Api/V1/ContactGroupResource.php",
    "app/Http/Resources/Api/V1/ContactResource.php",
    "app/Http/Resources/Api/V1/DeviceResource.php",
    "app/Http/Resources/Api/V1/FlowResource.php",
    "app/Http/Resources/Api/V1/MessageResource.php",
    "app/Http/Resources/Api/V1/ScheduledResource.php",
    "app/Http/Resources/Api/V1/TemplateResource.php",
    "app/Http/Resources/Api/V1/WebhookResource.php"
  ],
  "js_assets": ["resources/js/charts/user-developers-index.js"],
  "feature_map": {
    "WD-API-001": ["POST developers/keys"],
    "WD-API-002": ["GET developers"],
    "WD-API-003": ["DELETE developers/keys/{id}"],
    "WD-API-020": ["GET api/v1/me"],
    "WD-API-021": ["GET api/v1/usage"],
    "WD-API-022": ["GET api/v1/contacts"],
    "WD-API-023": ["GET api/v1/contacts/{id}"],
    "WD-API-024": ["POST api/v1/contacts"],
    "WD-API-025": ["PUT api/v1/contacts/{id}"],
    "WD-API-026": ["DELETE api/v1/contacts/{id}"],
    "WD-API-027": ["GET api/v1/contact-groups"],
    "WD-API-028": ["POST api/v1/contact-groups"],
    "WD-API-029": ["DELETE api/v1/contact-groups/{id}"],
    "WD-API-030": ["GET api/v1/templates"],
    "WD-API-031": ["GET api/v1/templates/categories"],
    "WD-API-032": ["POST api/v1/templates"],
    "WD-API-033": ["GET api/v1/templates/{id}"],
    "WD-API-034": ["PUT api/v1/templates/{id}"],
    "WD-API-035": ["DELETE api/v1/templates/{id}"],
    "WD-API-036": ["POST api/v1/templates/{id}/send"],
    "WD-API-038": ["GET api/v1/auto-replies"],
    "WD-API-039": ["POST api/v1/auto-replies"],
    "WD-API-040": ["GET api/v1/auto-replies/{id}"],
    "WD-API-041": ["PUT api/v1/auto-replies/{id}"],
    "WD-API-042": ["DELETE api/v1/auto-replies/{id}"],
    "WD-API-044": ["GET api/v1/flows"],
    "WD-API-045": ["GET api/v1/flows/{id}"],
    "WD-API-046": ["POST api/v1/flows/{id}/enroll"],
    "WD-API-047": ["GET api/v1/flows/{id}/subscribers"],
    "WD-API-048": ["GET api/v1/deals"],
    "WD-API-049": ["POST api/v1/deals"],
    "WD-API-050": ["GET api/v1/deals/{id}"],
    "WD-API-051": ["PUT api/v1/deals/{id}"],
    "WD-API-052": ["DELETE api/v1/deals/{id}"],
    "WD-API-080": ["POST api/v1/broadcasts"],
    "WD-API-081": ["GET api/v1/broadcasts"],
    "WD-API-082": ["GET api/v1/broadcasts/{id}"],
    "WD-API-083": ["GET api/v1/broadcasts/{id}/recipients"],
    "WD-API-084": ["POST api/v1/broadcasts/{id}/stop"],
    "WD-API-085": ["GET api/v1/campaigns/statistics"],
    "WD-API-086": ["GET api/v1/campaigns"],
    "WD-API-087": ["POST api/v1/campaigns"],
    "WD-API-088": ["GET api/v1/campaigns/{id}"],
    "WD-API-089": ["POST api/v1/campaigns/{id}/stop"],
    "WD-API-090": ["DELETE api/v1/campaigns/{id}"],
    "WD-API-091": ["POST api/v1/scheduled"],
    "WD-API-092": ["GET api/v1/scheduled"],
    "WD-API-093": ["GET api/v1/scheduled/{id}"],
    "WD-API-094": ["DELETE api/v1/scheduled/{id}"],
    "WD-API-110": ["POST api/v1/messages"],
    "WD-API-111": ["GET api/v1/messages"],
    "WD-API-112": ["GET api/v1/messages/{id}"],
    "WD-API-113": ["POST api/v1/media"],
    "WD-API-114": ["GET api/v1/conversations"],
    "WD-API-115": ["GET api/v1/conversations/{id}/messages"],
    "WD-API-116": ["GET api/v1/devices"],
    "WD-API-117": ["GET api/v1/devices/{id}"],
    "WD-API-140": ["GET api/v1/webhooks"],
    "WD-API-141": ["POST api/v1/webhooks"],
    "WD-API-142": ["DELETE api/v1/webhooks/{id}"],
    "WD-API-149": ["GET developers/docs", "GET docs", "GET docs/api"],
    "WD-API-150": ["GET docs/api.json"],
    "WD-API-151": ["DELETE developers/keys/{id}", "GET developers", "POST developers/keys"]
  }
}
```
