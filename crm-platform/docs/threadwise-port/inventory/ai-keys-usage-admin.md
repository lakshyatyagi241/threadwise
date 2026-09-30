---
domain: ai-keys-usage-admin
code: AIADM
title: AI provider keys, token metering and AI usage dashboards
threadwise_version: '1.7.0'
sources_read: 58
---

# AI provider keys, token metering and AI usage dashboards

## Overview

This domain is the "money plumbing" of every AI feature in Reference. It answers three questions each time any AI feature runs (AI agent reply, flow AI node, template/campaign "Build with AI", CRM copilot, voice STT/TTS, widget replies): **which API key is used**, **who pays for the tokens**, and **how much was burnt**. It also gives the platform owner and each customer a screen to see the burn.

Actors and surfaces:

- **Platform super-admin** (`/admin/*`, guarded by admin role check plus IP allowlist middleware): manages one _global_ key per AI provider (22 provider slots: 20 LLM brands plus ElevenLabs TTS and Deepgram STT), a default model per provider, an optional per-request output-token ceiling, and an Active flag. Also reads the platform-wide **AI Dashboard** (token burn by provider/model/workspace, platform-key vs BYOK split, estimated dollars, live key health).
- **Workspace owner/admin**: may add their **own key** (BYOK, "bring your own key") per provider. Two entry points write the same table: the Team Inbox "AI Provider Keys" modal (owned here) and the Settings > AI keys tab (owned by ASHELL, TW-ASHELL-039). BYOK is plan-gated at _resolution_ time by the plan feature `allow_byok_ai_keys`.
- **Workspace manager+**: reads **AI Usage** (`/ai-usage`): tokens, calls, estimated cost, plan-key vs own-key split, per-day/provider/model breakdown, and a progress bar against the plan's monthly token cap.
- **Every AI caller in the app** (other domains) goes through `AiKeyResolver` (key choice) and `AiTokenMeter` (ledger write). Those two services are owned here.

Main flow end to end: admin pastes a key on `/admin/api-keys` and saves (provider auto-activates) -> a workspace triggers an AI feature -> `AiKeyResolver::resolve(workspace, provider)` returns workspace key (if plan allows BYOK, or the workspace is owned by a platform admin, and an active workspace key exists) else the active admin key else nothing -> the caller performs the provider HTTP call -> `AiTokenMeter::record` inserts a row into `ai_token_usage` tagged `billed_against = admin | workspace` -> dashboards aggregate that ledger; the workspace's platform-key tokens this calendar month are compared with `ai_token_limit_monthly`.

Plan tiers: two plan columns drive this domain (owned by PLAN, consumed here): `allow_byok_ai_keys` (boolean, default off) and `ai_token_limit_monthly` (nullable unsigned int, null = unlimited). Platform-admin-owned workspaces are never plan-gated (effective limits become "true" / "-1 unlimited").

**Important reality check:** the monthly token cap is displayed but **never enforced** in v1.7.0 (`AiTokenMeter::guard` has no callers) and voice/Node-bridge AI usage is not written to the ledger. See TW-AIADM-018 and Open questions.

Connections to other domains: `plans-subscriptions-trials` (PLAN: the two plan columns and the package editor fields, `Workspace::effectiveLimit`), `admin-console-shell` (ASHELL: Settings > AI keys tab TW-ASHELL-039 writes `ai_provider_keys`; admin sidebar/hub shell), `roles-permissions` (RBAC: `integration.manage`, `workspace.role:manager`), `ai-agents-training` (AIAG: `AiAgentService::callProvider` is the main metering caller; agent/assistant model pickers use the model catalog), `ai-copilot-lead-finder` (AICRM: `AiCrmCopilotService` uses the resolver and a separate meter path), `calling-voice` and `node-bridge-runtime` (CALL/NODE: `api/waba-call/voice-keys` hands Deepgram/OpenAI/ElevenLabs keys to Node; Voice TTS/ASR drivers use the resolver), `flow-builder-editor`, `message-templates`, `campaigns`, `broadcasts`, `meta-ads` (FLB/TPL/CAMP/MADS: "Build with AI" and model-picker endpoints read `admin_ai_keys`), `team-inbox-conversations` (TIB1: hosts the BYOK modal JS and preloads `ai_keys` in the inbox bootstrap), `dashboards-analytics-charts` (DASH: System Health counts `ai_token_usage` rows in the last 24h), `platform-settings-branding-storage` (SET: admin settings hub card linking to API keys), `notifications-activity-audit` (NOTIF: no audit entries are written for key changes).

## Feature index

| Id           | Feature                                                                               | Status      | Priority | Effort | Depends on                               |
| ------------ | ------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------------- |
| TW-AIADM-001 | Admin AI keys page: provider registry with auto-created rows and status strip         | implemented | P0       | M      | TW-AIADM-006, TW-AIADM-008               |
| TW-AIADM-002 | Provider card credential fields (per-provider schema)                                 | partial     | P0       | M      | TW-AIADM-001                             |
| TW-AIADM-003 | Save provider settings (key, default model, sort order, extras) with auto-activate    | implemented | P0       | M      | TW-AIADM-001, TW-AIADM-006               |
| TW-AIADM-004 | Activate / deactivate a provider                                                      | implemented | P0       | S      | TW-AIADM-003                             |
| TW-AIADM-005 | Curated default-model catalog with custom-model preservation                          | implemented | P1       | S      | TW-AIADM-001                             |
| TW-AIADM-006 | Encrypted key storage with unreadable-key tolerance                                   | implemented | P0       | S      | -                                        |
| TW-AIADM-007 | Legacy /admin/ai-keys redirect                                                        | implemented | P2       | S      | TW-AIADM-001                             |
| TW-AIADM-008 | Provider row seeding and default-model refresh migrations                             | implemented | P1       | S      | TW-AIADM-001                             |
| TW-AIADM-009 | Platform max-tokens-per-request ceiling                                               | implemented | P1       | S      | TW-AIADM-003, TW-AIADM-016               |
| TW-AIADM-010 | Key resolution chain (workspace BYOK, then platform key, then none)                   | implemented | P0       | M      | TW-AIADM-003, TW-AIADM-006, TW-PLAN-*    |
| TW-AIADM-011 | Workspace BYOK keys: list and inbox preload                                           | implemented | P1       | S      | TW-AIADM-010                             |
| TW-AIADM-012 | Workspace BYOK key: add or replace                                                    | implemented | P1       | S      | TW-AIADM-011                             |
| TW-AIADM-013 | Workspace BYOK key: enable / disable                                                  | implemented | P1       | S      | TW-AIADM-011                             |
| TW-AIADM-014 | Workspace BYOK key: delete                                                            | implemented | P1       | S      | TW-AIADM-011                             |
| TW-AIADM-015 | AI model picker sourcing from active platform keys plus BYOK overlay                  | partial     | P1       | M      | TW-AIADM-003, TW-AIADM-010               |
| TW-AIADM-016 | Token usage metering (ledger write path)                                              | partial     | P0       | M      | TW-AIADM-010                             |
| TW-AIADM-017 | Monthly platform-key usage computation and its surfaces                               | implemented | P1       | S      | TW-AIADM-016                             |
| TW-AIADM-018 | Monthly AI token cap enforcement (guard)                                              | dead-code   | P1       | M      | TW-AIADM-017, TW-PLAN-*                  |
| TW-AIADM-019 | Estimated cost model (blended per-provider rates)                                     | implemented | P2       | S      | TW-AIADM-016                             |
| TW-AIADM-020 | Admin AI Dashboard: window switch and KPI strip                                       | implemented | P1       | M      | TW-AIADM-016, TW-AIADM-019               |
| TW-AIADM-021 | Admin AI Dashboard: daily burn trend                                                  | implemented | P1       | S      | TW-AIADM-020                             |
| TW-AIADM-022 | Admin AI Dashboard: tokens by provider and platform-vs-BYOK split                     | implemented | P1       | S      | TW-AIADM-020                             |
| TW-AIADM-023 | Admin AI Dashboard: top workspaces and top models                                     | implemented | P1       | S      | TW-AIADM-020                             |
| TW-AIADM-024 | Admin AI Dashboard: AI key health, BYOK totals and voice-call count                   | implemented | P1       | S      | TW-AIADM-020, TW-AIADM-001               |
| TW-AIADM-025 | Workspace AI Usage page: window switch and KPI cards                                  | implemented | P1       | M      | TW-AIADM-016, TW-AIADM-019               |
| TW-AIADM-026 | Workspace AI Usage: monthly plan cap meter                                            | partial     | P1       | S      | TW-AIADM-017                             |
| TW-AIADM-027 | Workspace AI Usage: daily bars, provider bars, key split, model table, voice footnote | implemented | P1       | M      | TW-AIADM-025                             |
| TW-AIADM-028 | Navigation entry points for the AI screens                                            | implemented | P2       | S      | TW-AIADM-001, TW-AIADM-020, TW-AIADM-025 |
| TW-AIADM-029 | Audit trail for AI key changes                                                        | docs-only   | P2       | S      | TW-AIADM-003, TW-NOTIF-*                 |

## Features

### TW-AIADM-001 — Admin AI keys page: provider registry with auto-created rows and status strip

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-AIADM-006, TW-AIADM-008
- **Summary:** The platform super-admin opens "AI / API keys" and sees one card for every supported AI provider (22 slots) plus a four-tile status strip (Providers, Active, Ready, No key set). Nothing has to be "installed": missing provider rows are created on demand, inactive and empty, and the admin only pastes a key and saves.
- **Actors & access:** platform admin only. Middleware chain on the whole `/admin` group: authenticated user, admin-role check (403 with message "Admins only." otherwise), IP allowlist middleware (skips itself when the security setting is off). No plan gate, no workspace scope (platform scope, global data).
- **UX & screens:** `resources/views/admin/api-keys/index.blade.php` (layout admin, admin-key `api-keys`, page id `admin-api-keys-index`). Header breadcrumb "Admin > AI / API keys"; eyebrow "Admin · System · AI providers"; title "AI API keys"; sub-copy says these are global keys that workspaces on plans without BYOK use as the fallback and that they are encrypted at rest. Session flash banners: green for `success`, coral for `error`. **Status strip** (4 tiles): Providers = total rows ("seeded"), Active = rows with is_active true ("enabled for fallback"), Ready = active AND a readable key ("active + has key"), No key set = rows with no readable key, tile turns amber when > 0 ("paste a key to ready"). **One card per provider**, in `sort_order` order, one card per row: title = provider display name; pill Active (green) or Disabled (grey); pill "Key saved" or "No key" (amber); mono line "provider: <slug> · default model: <model or dash>"; a right-aligned Activate / Disable button (POST form); then the edit form (see TW-AIADM-002/003) and a "Save <Name>" button. **Help footer card** "How these keys are used / Fallback chain": explains the workspace key wins only on BYOK plans, else the matching Active row here, and that disabling a provider means non-BYOK workspaces cannot use it. **Empty state** (no rows at all): "No AI providers configured" with a hint to run the seeder; effectively unreachable because the page creates rows itself. Page is server-rendered; no client JS beyond the browser's native form behavior.
- **Endpoints:**

| Method + uri         | Route name             | Controller@action                | Middleware                                | Request fields | Response                                                                                                  |
| -------------------- | ---------------------- | -------------------------------- | ----------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| GET `admin/api-keys` | `admin.api-keys.index` | Admin\AdminAiKeyController@index | web, auth, EnsureUserIsAdmin, IPAllowlist | none           | HTML page with `providers` (each decorated with fields_schema, decoded extras, model_choices) and `stats` |

- **Data:** reads and, on first visit, **writes** `admin_ai_keys` (a GET creates missing rows). Row creation key = `provider`; created with `name` from a fixed display-name map (OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI (Grok), Perplexity, Groq, Alibaba Qwen, Moonshot (Kimi), Z.ai (GLM), Cohere, NVIDIA, Meta Llama, Hugging Face, Baidu (Ernie), AI21 (Jamba), Reka, 01.AI (Yi), OpenRouter, ElevenLabs, Deepgram), `is_active = false`, `sort_order` = the provider's zero-based position in the field-schema order, api_key/default_model/extra_config null. The 22 slugs in schema order: openai, anthropic, gemini, mistral, openrouter, deepseek, xai, perplexity, groq, qwen, moonshot, zai, cohere, nvidia, llama, huggingface, baidu, ai21, reka, yi, elevenlabs, deepgram. Cards listed ordered by `sort_order` ascending only (no tiebreaker).
- **Rules & edge cases:**
  1. Row creation is `first-or-create` by provider: existing rows (including their name, model, sort order, active state) are never touched by the page.
  2. QUIRK: a GET request writes to the database (up to 22 inserts on first visit). A port should do this in a migration/seed or an explicit idempotent "ensure providers" call, not in a read endpoint.
  3. QUIRK: rows seeded at install use sort orders 1-6 (openai 1, anthropic 2, gemini 3, mistral 4, elevenlabs 5, deepgram 6) while rows auto-created by the page use their schema index (openrouter 4, deepseek 5, xai 6, perplexity 7 ... yi 19). Result: ties at 4, 5 and 6 whose relative order is undefined (no secondary sort), and the order does not match the intended "LLMs first, voice last" grouping.
  4. QUIRK: seeded display names differ from the map (seed says "Anthropic Claude"; the map says "Anthropic"); whichever created the row first wins and it is never renamed.
  5. "Ready" and "No key" are computed from the _decrypted_ key: a row whose ciphertext cannot be decrypted (APP_KEY rotated) counts as "No key" and not "Ready", even though it may still be flagged Active (see TW-AIADM-006).
  6. Only slugs present in the field schema get rows. Two catalog entries (`together`, `fireworks`) exist in the model list and in the OpenAI-compatible base-URL map used by the caller, but have no card, so they can never get a key (dead provider slots).
  7. The page never displays a saved API key (input is always empty; placeholder tells the admin to leave blank to keep). Non-secret extras (organization, project id, voice id, max tokens) are pre-filled.
- **Async & events:** none.
- **External systems:** none (no live key validation against the vendor; saving never calls the provider).
- **Settings:** none. IP allowlist and admin role come from security settings (AUTH/SET).
- **Acceptance criteria:**
  - Given a fresh install seeded with 6 providers, when the admin opens `/admin/api-keys` for the first time, then 22 cards are shown (16 new rows created inactive with "No key"), the Providers tile says 22, Active 0, Ready 0, No key set 22.
  - Given a non-admin logged-in user, when they request `/admin/api-keys`, then they receive 403.
  - Given openai is active with a readable key and mistral has none, then Active = 1, Ready = 1, and the mistral card shows "No key".
  - Given a stored key that cannot be decrypted, when the page loads, then it renders (no 500) with that card marked "No key".
  - Given the page was opened before, when it is opened again, then no rows are added or modified.
- **Source refs:** app/Http/Controllers/Admin/AdminAiKeyController.php (index), app/Models/AdminAiKey.php, resources/views/admin/api-keys/index.blade.php, routes/admin.php, database/migrations/2026_05_18_010000_sprint6_schema.php, Documentation/pages/admin-panel/ai-keys.html.
- **Port notes:** new table `ai_provider_platform_keys` (platform scope, no tenant id, so no RLS; guard by super-admin permission) in an AI settings module e.g. `apps/api/src/modules/ai-keys/`. Seed the provider catalog once in a migration and make GET side-effect free. Store the provider catalog (slug, display name, group llm/voice, field schema, model list, default model, base URL, sort order) as a versioned config/table so new brands are a data change. Keep the four-count status strip as a single aggregate query.

### TW-AIADM-002 — Provider card credential fields (per-provider schema)

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-AIADM-001
- **Summary:** Each provider card renders only the fields that vendor needs: a required masked API key and, for a few vendors, optional extras. Some advertised extras are stored but nothing ever reads them.
- **Actors & access:** platform admin only.
- **UX & screens:** inside each card of `admin/api-keys/index.blade.php`. Field definitions per provider (label / control / hint intent):
  - **openai:** API key (password, required; hint to platform.openai.com/api-keys); Organization ID (text, optional); Max tokens per request (text, placeholder 4096, optional).
  - **anthropic, mistral, openrouter:** API key (required) and Max tokens per request (optional). openrouter's hint says one key unlocks all listed models.
  - **gemini:** API key (required), Project ID (optional, "for Vertex AI billing"), Max tokens per request.
  - **elevenlabs:** API key (required), Default voice ID (optional).
  - **deepgram:** API key (required; hint says it powers AI voice-call speech-to-text).
  - **deepseek, xai, perplexity, groq, qwen, moonshot, zai, cohere, nvidia, llama, huggingface, baidu, ai21, reka, yi:** only API key (password, required, with a vendor-specific "where to create it" hint). No max-tokens field for these.
    The API key control is a password input that is **never pre-filled** (autocomplete off, placeholder "paste key here" or, when a key exists, a bullets placeholder saying saved/leave blank to keep). Text extras are pre-filled from `extra_config`. The label carries a red asterisk when `required`; "required" is presentational only (server accepts a blank key).
- **Endpoints:** none of its own (rendered by GET `admin/api-keys`, submitted through PATCH `admin/api-keys/{id}`, see TW-AIADM-003).
- **Data:** extras live in `admin_ai_keys.extra_config` as a small JSON object keyed by field key: `organization`, `project_id`, `voice_id`, `max_tokens` (all strings). Column is varchar(500) so the whole JSON must stay under 500 characters. The API key lives in `api_key`, never in `extra_config`.
- **Rules & edge cases:**
  1. Only field keys defined for that provider are accepted into `extra_config`; other submitted keys are ignored.
  2. QUIRK (dead config): `organization`, `project_id` and `voice_id` are saved but no code path reads them (the OpenAI call does not send the organization header, Gemini ignores project id, and the ElevenLabs driver refuses to pick a default voice and instead throws when the agent has no voice id). Docs and hints promise otherwise. Do not port the effect; port the fields only if the port actually wires them.
  3. `max_tokens` is the only extra with runtime effect (TW-AIADM-009); it has no numeric validation (any string up to 500 chars is stored; non-numeric parses to 0 meaning "no cap").
  4. `extra_config.models` (a list of additional model ids to offer beside the default) is read by the model pickers (TW-AIADM-015) but there is **no field** for it, so it can only be set directly in the database.
  5. `FIELD_SCHEMA` also has a static accessor `fieldSchemaFor(provider)` that nothing calls (dead code).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the openai card, then it shows API key, Organization ID and Max tokens per request; the deepseek card shows only API key.
  - Given a provider already has a saved key, when the card is rendered, then the key input is empty with a "leave blank to keep" placeholder and the raw secret is not present anywhere in the HTML.
  - Given an Anthropic max-tokens value of 4096 saved earlier, when the page reloads, then the field shows 4096.
  - Given an unknown extra field name is posted for a provider, then it is ignored and not stored.
- **Source refs:** app/Http/Controllers/Admin/AdminAiKeyController.php (FIELD_SCHEMA, fieldSchemaFor), resources/views/admin/api-keys/index.blade.php, app/Services/Voice/Drivers/ElevenLabsTtsDriver.php, Documentation/pages/admin-panel/ai-keys.html.
- **Port notes:** model the schema as data (per provider: key, label, type, required, hint, secret flag). Implement each extra only if wired (e.g. send OpenAI organization header; support a default voice); otherwise leave the field out and note it as not ported. Encrypt any secret-typed extra at rest as well.

### TW-AIADM-003 — Save provider settings (key, default model, sort order, extras) with auto-activate

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-AIADM-001, TW-AIADM-006
- **Summary:** Saving a provider card stores the pasted API key (only when one is typed), the default model, the display order and the optional extras, and switches the provider on automatically as soon as it has a key.
- **Actors & access:** platform admin only (same middleware as TW-AIADM-001).
- **UX & screens:** the per-card form in `admin/api-keys/index.blade.php`: masked API key, extras, Default model select (placeholder option "Pick a default model", then the curated list for the provider, plus a "(custom)" option for a stored value outside the list), Sort order number input (min 0), submit button "Save <Provider name>". After submit the page redirects back with a green flash: "<Name> saved + activated." when the row is active after the save, else "<Name> settings saved."
- **Endpoints:**

| Method + uri                             | Route name              | Controller@action                 | Middleware                                | Request fields                                                                                                                                                             | Response                                                                                            |
| ---------------------------------------- | ----------------------- | --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| PATCH `admin/api-keys/{id}` (id numeric) | `admin.api-keys.update` | Admin\AdminAiKeyController@update | web, auth, EnsureUserIsAdmin, IPAllowlist | `default_model` nullable string max 80; `api_key` nullable string max 1024; `sort_order` nullable integer min 0; `extra` nullable array; `extra.*` nullable string max 500 | redirect back with flash success; 404 when id unknown; 422 (back with errors) on validation failure |

- **Data:** updates one `admin_ai_keys` row: `api_key` (encrypted on write), `default_model`, `sort_order`, `extra_config` (JSON, unescaped unicode), `is_active`, `updated_at`.
- **Rules & edge cases:**
  1. The API key is overwritten **only** when a non-empty value is submitted. Blank = keep existing. There is **no way to clear a saved key** from this screen (blank keeps, and a clear path is not offered); the only options are overwrite or deactivate.
  2. `default_model` and `sort_order` fall back to the stored value when the submitted value is null (an empty string is converted to null by the framework), so they also cannot be blanked.
  3. `extra_config` starts from the stored JSON; for each field the provider's schema defines (except api_key) that appears in the submission and is not the empty string, the value is written. Because the framework's empty-string-to-null conversion runs before this loop and the check is against the literal empty string, a cleared text extra arrives as null and is written as JSON null, i.e. clearing a pre-filled extra effectively removes it. This contradicts the docs statement that "an empty field never wipes a saved value" (QUIRK; extras are pre-filled so accidental wipes are unlikely).
  4. **Auto-activate:** after applying changes, if the row has a readable key (stored or just submitted) then `is_active` is forced to true, even if the admin had deliberately deactivated it earlier. Saving an unrelated field (e.g. sort order) on a keyed, deactivated provider therefore re-activates it. QUIRK relied on by the UX comment ("Save should turn it ON").
  5. Saving a row without a key never deactivates it, and never creates an activation.
  6. `sort_order` column is smallint unsigned (max 65535); larger values pass validation but fail at the database. `extra_config` over 500 characters also fails at the database (validation allows 500 per value, not in total).
  7. The API key value is not trimmed or format-checked, and no live vendor test is performed.
  8. A provider slug with no schema (a hand-inserted row) still accepts an API key; extras are ignored.
- **Async & events:** none. No audit-log entry is written (see TW-AIADM-029). No cache to bust: keys are read from the table on every AI call.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a provider without a key, when the admin submits a key and a default model, then the row has an encrypted key, is Active, and the flash reads "<Name> saved + activated."
  - Given a provider with a saved key, when the admin submits only a new default model with the key field blank, then the stored key is unchanged and the model is updated.
  - Given `api_key` longer than 1024 characters, then the request fails validation and nothing is saved.
  - Given a deactivated provider with a key, when the admin saves any field, then the provider becomes Active again.
  - Given an unknown id, then 404.
- **Source refs:** app/Http/Controllers/Admin/AdminAiKeyController.php (update), app/Models/AdminAiKey.php, resources/views/admin/api-keys/index.blade.php, Documentation/pages/admin-panel/ai-keys.html.
- **Port notes:** use a DTO with the same validation. Preserve "blank keeps existing secret"; consider adding an explicit "Remove key" action (missing in Reference). Keep auto-activate but prefer activating only when the save transitions the row from keyless to keyed, to avoid the re-activation surprise; record the deviation if you change it. Emit an audit event (TW-AIADM-029). Never return the secret in any GET.

### TW-AIADM-004 — Activate / deactivate a provider

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-AIADM-003
- **Summary:** A one-click switch on each card turns the provider's platform key on or off as a fallback for every workspace. Activation is refused until a key exists.
- **Actors & access:** platform admin only.
- **UX & screens:** the button in the card header (label "Activate" in green when off, "Disable" when on); a plain POST form (full page reload). Flash messages: error "Add an API key before activating." when trying to activate a keyless row; success "Activated." or "Deactivated."
- **Endpoints:**

| Method + uri                                   | Route name              | Controller@action                 | Middleware                                | Request fields | Response                                                      |
| ---------------------------------------------- | ----------------------- | --------------------------------- | ----------------------------------------- | -------------- | ------------------------------------------------------------- |
| POST `admin/api-keys/{id}/toggle` (id numeric) | `admin.api-keys.toggle` | Admin\AdminAiKeyController@toggle | web, auth, EnsureUserIsAdmin, IPAllowlist | none           | redirect back with flash success or error; 404 for unknown id |

- **Data:** flips `admin_ai_keys.is_active`.
- **Rules & edge cases:**
  1. Guard applies only to _activating_: inactive AND no readable key -> error, no change. Deactivating is always allowed.
  2. "No readable key" includes an undecryptable ciphertext (APP_KEY rotation), so such a row cannot be re-activated until the admin re-pastes the key.
  3. Effect of Active=false: `AiKeyResolver` stops returning that platform key immediately (no caching); model pickers stop listing the provider; workspaces on plans without BYOK lose that provider. Workspaces with a usable BYOK key for the provider keep working.
  4. Active rows are not verified against the vendor; a wrong key stays "Active" until a call fails.
  5. A row can remain Active while its key is no longer decryptable (rotation after activation). The dashboard shows it as not live (TW-AIADM-024) but pickers still list it (TW-AIADM-015) and calls fail (resolver returns nothing).
- **Async & events:** none; no notification, no audit entry.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a provider without a key, when Activate is clicked, then the state is unchanged and the error "Add an API key before activating." is shown.
  - Given an active provider, when Disable is clicked, then it becomes inactive and the flash says "Deactivated.".
  - Given an inactive provider with a key, when Activate is clicked, then it becomes active and the flash says "Activated.".
  - Given a provider is deactivated, when a non-BYOK workspace runs an AI feature for it, then the resolver returns no key and the feature reports that no key is available.
- **Source refs:** app/Http/Controllers/Admin/AdminAiKeyController.php (toggle), resources/views/admin/api-keys/index.blade.php, Documentation/pages/admin-panel/ai-keys.html.
- **Port notes:** make the toggle idempotent by accepting an explicit desired state in the port (Reference toggles blindly, so a double-click flips twice).

### TW-AIADM-005 — Curated default-model catalog with custom-model preservation

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-AIADM-001
- **Summary:** Each provider card offers a dropdown of known model ids for that vendor (newest first, legacy entries last). The same catalog is reused as the model dropdown in AI agent and inbox-agent editors. A stored model that is not in the list stays selectable, tagged "(custom)".
- **Actors & access:** dropdown editing: platform admin. Catalog consumption: any workspace user who can open the AI agent editors (`_ai_agent_form_modal`, chat page agent panel), via a public constant of the admin controller.
- **UX & screens:** Default model select on each card (see TW-AIADM-003). In the agent editor modal (`resources/views/user/partials/_ai_agent_form_modal.blade.php`) and the chat agent panel (`resources/views/user/chat/index.blade.php`) the model select renders every provider's list as option groups labelled with the capitalised provider slug. `resources/js/charts/user-ai-assistants-wizard.js` keeps its own small provider-to-default-model map (gemini gemini-2.5-flash-lite, openai gpt-4o-mini, anthropic claude-haiku-4-5-20251001) documented as "kept in sync" with the catalog (it is not automatically in sync).
- **Endpoints:** none of its own.
- **Data:** the catalog is a constant, not a table. Provider -> ordered list (these are identifiers, port them as config and expect to re-verify against vendors, several ids are speculative future names):
  - openai: gpt-5.6, gpt-5.6-pro, gpt-5.6-mini, gpt-5.5, gpt-5.5-pro, gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.4-nano, gpt-5-mini, gpt-5-nano, gpt-4.1, gpt-4.1-mini, then legacy gpt-4o, gpt-4o-mini.
  - anthropic: claude-opus-5, claude-fable-5, claude-sonnet-5, claude-haiku-4-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-sonnet-4-6.
  - gemini: gemini-3.5-flash, gemini-3.1-pro-preview, gemini-3.1-flash-lite, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite.
  - mistral: mistral-large-latest, mistral-medium-latest, mistral-small-latest, codestral-latest, ministral-3-14b-25-12, ministral-3-8b-25-12, devstral-2-25-12, magistral-medium-1-2-25-09.
  - elevenlabs: eleven_v3, eleven_multilingual_v2, eleven_turbo_v2_5, eleven_flash_v2_5.
  - deepgram: nova-3, nova-2 (informational only; the call bridge pins nova-2 itself).
  - openrouter: a curated 20 of provider/model ids (Anthropic 3, OpenAI 5, Google 3, Meta 2, DeepSeek 2, Qwen, Mistral 2, xAI grok-4, Z.ai glm-4.6); any other id may be stored.
  - deepseek: deepseek-chat, deepseek-reasoner. xai: grok-4, grok-4-fast, grok-3. perplexity: sonar-pro, sonar, sonar-reasoning-pro. groq: llama-3.3-70b-versatile, llama-4-maverick-17b-128e-instruct, moonshotai/kimi-k2-instruct. together (no card): 3 ids. fireworks (no card): 2 ids. qwen: qwen-max, qwen-plus, qwen-turbo. moonshot: kimi-k2-0905-preview, moonshot-v1-128k, moonshot-v1-32k. zai: glm-4.6, glm-4.5, glm-4.5-air. cohere: command-a-03-2025, command-r-plus, command-r. nvidia: 2 ids. llama: 2 ids. huggingface: 2 ids. baidu: ernie-4.5-turbo-128k, ernie-4.5-8k. ai21: jamba-large, jamba-mini. reka: reka-core, reka-flash. yi: yi-lightning, yi-large.
- **Rules & edge cases:**
  1. The select always shows the stored `default_model` even if it is not in the catalog, marked "(custom)" so a value is never silently dropped.
  2. The server does not validate `default_model` against the catalog (any string up to 80 chars is accepted), so admins can type ids via API tooling and the OpenRouter note says any id from the vendor site is valid.
  3. The catalog lists providers `together` and `fireworks` for which no key card exists (see TW-AIADM-001 rule 6).
  4. Docs list five providers and old model sets (e.g. seeded Anthropic default claude-opus-4-7, models such as Sonnet 4.5); the code has 22 and newer ids. Treat the code as truth.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin opens the openai card, then the select offers the openai list above in that order with the legacy entries last.
  - Given a stored default model not in the list, then the select shows it selected and labelled "(custom)".
  - Given a workspace member opens the AI agent editor, then the model select is grouped by provider using the same catalog.
- **Source refs:** app/Http/Controllers/Admin/AdminAiKeyController.php (MODELS), resources/views/user/partials/_ai_agent_form_modal.blade.php, resources/views/user/chat/index.blade.php, resources/js/charts/user-ai-assistants-wizard.js.
- **Port notes:** expose the catalog through a contracts endpoint or shared package constant and consume it in both the admin form and agent editors so they cannot drift; keep it editable data (table or config) rather than code. Do not copy the speculative model ids blindly, refresh them against vendors at build time.

### TW-AIADM-006 — Encrypted key storage with unreadable-key tolerance

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** -
- **Summary:** All provider API keys (platform and workspace) are encrypted before being saved and decrypted on read. If decryption fails (master key changed) the key is treated as absent instead of crashing pages or AI features.
- **Actors & access:** internal; applies to `AdminAiKey` and `AiProviderKey` models.
- **UX & screens:** effect visible as "No key" on the admin cards, "Not configured" style states elsewhere. No dedicated screen.
- **Endpoints:** none.
- **Data:** `admin_ai_keys.api_key` (text, nullable) and `ai_provider_keys.api_key` (text, not null) hold framework-encrypted strings tied to the application key. `extra_config` is stored in plaintext JSON.
- **Rules & edge cases:**
  1. The framework's automatic `encrypted` cast is intentionally **not** used; accessors do the decryption in a try/catch so one stale row cannot break a whole list page.
  2. Empty string or null on write stores null (admin) - for workspace keys an empty key is stored as null in a NOT NULL column, which would error, but no caller sends an empty key (validation requires non-empty).
  3. Rows created by migrations use raw empty string `''` in `api_key` (not encrypted); the accessor returns null for it, so "no key".
  4. After an application-key rotation every stored key silently becomes "no key"; recovery = re-paste each key. Docs call this out.
  5. Keys are decrypted per access and handed to callers as plain strings; callers must not log them. The Node voice-key hand-off logs only a masked fingerprint (first 3, last 3, length).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the application encryption key (.env `APP_KEY`) is the sole secret.
- **Acceptance criteria:**
  - Given a key is saved, then the database column does not contain the plaintext.
  - Given the application key is changed, when the admin AI keys page loads, then it renders with those cards showing "No key" and the AI features report no key rather than raising server errors.
  - Given a blank key is written through the model, then the column becomes null.
- **Source refs:** app/Models/AdminAiKey.php, app/Models/AiProviderKey.php, app/Services/AiKeyResolver.php, database/migrations/2026_06_13_130000_seed_remaining_admin_ai_keys.php.
- **Port notes:** use envelope encryption (a KMS-managed or env master key with a key-id column so rotation re-wraps instead of destroying keys) and keep the "decrypt failure = treat as missing, log a warning with row id" behavior. Add `key_version`/`last_four` columns for supportability; never store or log plaintext.

### TW-AIADM-007 — Legacy /admin/ai-keys redirect

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-AIADM-001
- **Summary:** Old links to `/admin/ai-keys` (missing the "p") redirect to the real page.
- **Actors & access:** platform admin (same admin group middleware; a logged-out visitor is sent to login first).
- **UX & screens:** none; a browser redirect to `admin/api-keys`.
- **Endpoints:**

| Method + uri                                  | Route name                  | Controller@action                     | Middleware                                | Request fields | Response                         |
| --------------------------------------------- | --------------------------- | ------------------------------------- | ----------------------------------------- | -------------- | -------------------------------- |
| GET, POST, PUT, PATCH, DELETE `admin/ai-keys` | `admin.` (unnamed redirect) | Illuminate\Routing\RedirectController | web, auth, EnsureUserIsAdmin, IPAllowlist | none           | 302 redirect to `admin/api-keys` |

- **Data:** none.
- **Rules & edge cases:**
  1. The redirect registers for every HTTP verb; the framework default status is 302. Non-GET requests are redirected as GET-like navigations and lose their body.
  2. The route shows a blank name ("admin." with empty suffix) in the route list; harmless.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin, when they GET `/admin/ai-keys`, then they are redirected to `/admin/api-keys`.
  - Given a non-admin, when they GET `/admin/ai-keys`, then they get 403 (middleware runs before the redirect).
- **Source refs:** routes/admin.php.
- **Port notes:** a single web-app redirect (Next.js `redirects()`) is enough; no API equivalent needed. Keep only if legacy bookmarks matter for the port.

### TW-AIADM-008 — Provider row seeding and default-model refresh migrations

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-AIADM-001
- **Summary:** Fresh installs get the six original provider rows through a seeder, and idempotent migrations ensure the same rows exist (and stale default models are moved to current ones) on upgraded installs, without ever touching an admin-entered key.
- **Actors & access:** installer / deployment; not user-facing.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** writes `admin_ai_keys`.
  - `AdminAiKeySeeder` (called from the main database seeder): first-or-create by provider with name, default model, sort order, inactive, extra_config `[]`. Rows: openai "OpenAI" gpt-5.4-mini (1); anthropic "Anthropic Claude" claude-opus-4-8 (2); gemini "Google Gemini" gemini-3.5-flash (3); mistral "Mistral" mistral-large-latest (4); elevenlabs "ElevenLabs" eleven_v3 (5); deepgram "Deepgram" nova-2 (6). It never overwrites an existing row.
  - Migration 2026_05_23 seeds elevenlabs (model eleven_turbo_v2_5, sort max+1) when missing; 2026_06_13 seeds the four LLM rows when missing (blank key, inactive) and pushes elevenlabs to sort 5; 2026_07_10 seeds deepgram (nova-2, sort max+1) when missing.
  - Migration 2026_06_18_010000 moves any anthropic row still on claude-opus-4-7 to claude-opus-4-8. Migration 2026_06_18_020000 "refresh stale defaults": for openai/anthropic/gemini/mistral/elevenlabs, an **inactive** row is set to the current default model; an **active** row is changed only when its stored default is a known retired id (retired lists: old GPT-3.5/4 ids, Claude 3.x/2.x ids, Gemini 1.x ids, two old ElevenLabs ids). The down step is a no-op. Deepgram and the 15 extra brands are not refreshed.
  - The seeded local database holds exactly these 6 rows, all inactive, no keys, `extra_config = []`.
- **Rules & edge cases:**
  1. All steps are idempotent existence checks; they never modify `api_key` or an active row's deliberate model.
  2. Migration down-steps delete a row only when its `api_key` is still the empty string, preserving admin keys.
  3. The refresh migration keys off `is_active` as a proxy for "key in use", so an inactive row holding a saved key can still be moved to a new default model.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an empty `admin_ai_keys` table, when the seeder runs, then 6 inactive rows exist with the names, defaults and sort orders above.
  - Given an admin already saved a key on openai, when the seeder or migrations re-run, then the key, active flag and model are untouched.
  - Given an active anthropic row on a retired model id, when the refresh runs, then it moves to the current default; if it is active on a non-retired custom model it is unchanged.
- **Source refs:** database/seeders/AdminAiKeySeeder.php, database/seeders/DatabaseSeeder.php, database/migrations/2026_05_23_030000_seed_elevenlabs_admin_ai_key.php, database/migrations/2026_06_13_130000_seed_remaining_admin_ai_keys.php, database/migrations/2026_06_18_010000_bump_anthropic_default_to_opus_4_8.php, database/migrations/2026_06_18_020000_refresh_stale_admin_ai_default_models.php, database/migrations/2026_07_10_010000_seed_deepgram_admin_ai_key.php, database/1.1.sql.
- **Port notes:** put the catalog in a seed migration for the new table; skip the incremental history (it is upgrade-path baggage) but keep the "never overwrite an active/keyed row" invariant for any future default-model refresh job. Assign all 22 rows with a deliberate, collision-free sort order at seed time (fixes the tie quirk).

### TW-AIADM-009 — Platform max-tokens-per-request ceiling

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-AIADM-003, TW-AIADM-016
- **Summary:** The admin can cap the output tokens of any single request made through a provider's key, protecting the platform from runaway spend regardless of what an assistant, flow node or feature asked for.
- **Actors & access:** configured by platform admin (fields exist for openai, anthropic, gemini, mistral, openrouter only); enforced on every AI text call for any workspace.
- **UX & screens:** the "Max tokens per request" text field on the five provider cards (hint: optional ceiling, blank means the model default).
- **Endpoints:** set via PATCH `admin/api-keys/{id}` (extra.max_tokens).
- **Data:** `admin_ai_keys.extra_config.max_tokens`.
- **Rules & edge cases:**
  1. Applied inside the central provider call: if the row for the _requested provider_ exists and its max_tokens (cast to int) is greater than 0 and smaller than the requested `maxTokens`, the request is lowered to the ceiling. Blank/0/non-numeric = no extra cap.
  2. The ceiling is read from the platform row **regardless of which key is used** (a BYOK workspace is capped too, since the lookup is by provider only and does not check active state).
  3. Lookup failures are swallowed; the ceiling never blocks a reply.
  4. Only callers that go through the central call are capped. The CRM copilot and other direct HTTP callers may not honor it (see AICRM/AIAG).
  5. The lookup ignores `is_active`, so an inactive provider's ceiling still applies to BYOK traffic.
- **Async & events:** none.
- **External systems:** applies to output-token parameters of the vendor requests.
- **Settings:** per provider `max_tokens` (default: unset = no ceiling).
- **Acceptance criteria:**
  - Given openai max_tokens = 1000 and a flow AI node requesting 4000, when the call is made, then the vendor request is sent with 1000.
  - Given max_tokens blank, when a call requests 512, then 512 is sent.
  - Given max_tokens = 1000 and a call requesting 300, then 300 is sent (ceiling only lowers).
- **Source refs:** app/Services/AiAgentService.php (callProvider), app/Http/Controllers/Admin/AdminAiKeyController.php.
- **Port notes:** implement in the AI gateway/provider-adapter layer (`apps/api/src/modules/ai/`), reading the platform provider config (cached with short TTL). Decide explicitly whether the ceiling applies to BYOK (Reference: yes).

### TW-AIADM-010 — Key resolution chain (workspace BYOK, then platform key, then none)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-AIADM-003, TW-AIADM-006, TW-PLAN-*
- **Summary:** For any AI call the system picks the API key in a fixed order: the workspace's own active key when its plan (or ownership) allows BYOK, else the platform's active key for that provider, else nothing. The chosen source is reported so usage can be billed to the right side.
- **Actors & access:** internal service `AiKeyResolver`, called from every AI-using domain. Plan gate: feature flag `allow_byok_ai_keys` from the workspace's effective plan (plan overrides and add-ons applied by `Workspace::effectiveLimit`).
- **UX & screens:** effects appear as picker contents and error text such as "Admin has not enabled this provider in /admin/api-keys" (template/campaign/flow generate endpoints), "No AI key configured. Add one in Admin -> API keys (or your own key under your AI keys)" (Facebook composer). Settings > AI keys tab (ASHELL-039) shows a per-provider source badge: "Your key", "Shared key", "Not configured".
- **Endpoints:** none (service). Public interface: `resolve(workspace|null, provider) -> {key|null, source: workspace|admin|none, model|null}` and `keyFor(workspace, provider) -> key|null`.
- **Data:** reads `ai_provider_keys` (workspace_id, provider, is_active), `admin_ai_keys` (provider, is_active, api_key, default_model), workspace plan limits and owner user role.
- **Rules & edge cases:**
  1. Provider slug is trimmed and lower-cased first. Unknown slugs are allowed through and simply resolve to none.
  2. With a workspace: BYOK allowed = `effectiveLimit('allow_byok_ai_keys', false)` (per-workspace plan override wins outright, then plan, then add-ons); **or** the workspace is owned by a platform admin (the install owner is never plan-gated). If allowed and an _active_ workspace key for the provider decrypts to non-empty -> return it with source `workspace` and model null.
  3. Otherwise the platform row for the provider must be active **and** have a readable key -> source `admin` with that row's default model.
  4. Otherwise `{key: null, source: none, model: null}`; the caller must surface a clear error. There is deliberately **no environment-variable fallback** (an old env key exists only in a dead helper).
  5. A workspace key exists in the table but the plan does not allow BYOK: the stored key is ignored silently; UI in some places still advertises it (see TW-AIADM-015 and quirks).
  6. The workspace-owner-is-admin check is memoised per request in a static cache.
  7. When workspace is null (system-level call) only the platform key is considered.
  8. Only the `model` from the platform row is returned; callers combine it with their own model choice (e.g. CRM copilot uses the returned model or its own default per provider: anthropic claude-haiku-4-5-20251001, openai gpt-4o-mini, gemini gemini-3.5-flash).
  9. The CRM copilot picks its provider by trying anthropic, openai, gemini in order, first preferring any provider where the _workspace_ has its own key, then the first provider with any key.
- **Async & events:** none. Each call re-reads the database (no cache), so activation changes take effect immediately.
- **External systems:** none.
- **Settings:** plan feature `allow_byok_ai_keys` (default false in `packages`), per-workspace `plan_overrides`, add-on grants.
- **Acceptance criteria:**
  - Given a workspace on a BYOK plan with an active own openai key and an active platform openai key, when openai is requested, then the own key is returned with source `workspace`.
  - Given a workspace on a non-BYOK plan that has a stored own key, then the platform key is returned with source `admin`.
  - Given a workspace owned by a platform admin on a non-BYOK plan with its own key, then the own key is returned.
  - Given neither key is usable, then the result is `none` with a null key and the calling feature reports a user-visible error.
  - Given the platform row was deactivated a second ago, then the next call sees no platform key.
- **Source refs:** app/Services/AiKeyResolver.php, app/Models/AiProviderKey.php, app/Models/AdminAiKey.php, app/Models/Workspace.php (effectiveLimit, ownedByPlatformAdmin), app/Services/AiAgentService.php, app/Services/AiCrm/AiCrmCopilotService.php, app/Services/Voice/Drivers/*.php, app/Http/Controllers/FlowNodeActionsController.php, Documentation/pages/admin-panel/ai-keys.html.
- **Port notes:** implement as an injectable `AiKeyResolver` in the AI module, tenant-aware (workspace id from request context, RLS on `workspace_ai_keys`); the platform table is read through a super-admin-scoped repository. Return a typed source enum and pass it to the meter. Keep the "admin-owned workspace bypass" only if the target has an equivalent of a platform-owner workspace; otherwise model it as a plan override.
