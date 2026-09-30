---
domain: message-templates
code: TPL
title: Message Templates (WABA + local), Variables, Send-time Overrides
wadesk_version: '1.7.0'
sources_read: 62
---

# Message Templates (WABA + local), Variables, Send-time Overrides

## Overview

A "template" in WaDesk is a reusable, pre-written message with a header, body, footer, buttons, optional media/location/carousel and `{{variables}}`. One table (`wa_templates`) serves every outbound channel, and the same library feeds Team Inbox, Chat, Broadcasts, WhatsApp Campaigns, Scheduled sends, Flow builder nodes, Auto-reply, booking/invoice/e-commerce notifications, the mobile app, the Chrome extension and the public API. What a template _is_ depends on the `channel` stored on the row:

| channel                                                               | What it is                                                                                                                                                                                                                       | Approval                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `waba`                                                                | Meta Cloud API template. Created locally, linted, submitted to Meta's `message_templates` endpoint, then tracked through Meta's status machine (PENDING, APPROVED, REJECTED, PAUSED, ...). Only Meta-approved rows are sendable. | Meta review (minutes to ~48h) |
| `baileys`                                                             | "Unofficial API" template: a saved message sent as ordinary text + buttons. Auto-approved on save.                                                                                                                               | none                          |
| `twilio`                                                              | Row that points at a Twilio Content Template by `twilio_content_sid` (`HX` + 32 hex). Content is authored in Twilio, not in WaDesk. Auto-approved on save.                                                                       | none (Twilio-side)            |
| `instagram`, `facebook`, `telegram`, `line`, `wechat`, `viber`, `sms` | Local reusable DM / bot / SMS messages (text + optional buttons). Auto-approved. The channel only exists in the UI while the channel is enabled system-wide and at least one account is connected.                               | none                          |

Who uses it: workspace owner/admin/manager (route gate `workspace.role:manager`; agents and viewers are redirected to `/team-inbox`; platform admins bypass), operators picking a template while sending, API clients (`/api/v1/templates*`), the mobile app (`/api/app/*templates*`), the Chrome extension, and the Node bridge (internal fetch of a template blob). Super-admin controls the platform switch `waba_templates_v2_enabled` (default OFF) that turns on Meta submission, status sync and WABA template sending.

Main flow end to end (WABA): operator opens `/templates`, chooses "New Template Message" > WhatsApp > Standard / Carousel / Catalog, fills the create form (name, Meta category, language, header/attachment, body with `{{name}}`-style tokens, footer, up to 3 buttons, optional "Build with AI"), and saves. The server checks the plan (`template` feature + `template_limit`), normalizes named placeholders to positional `{{1}}`, derives a `variable_map` (slot to contact attribute), stores the row (text columns encrypted at rest), then lints it (`TemplateLinter`), uploads header/card media to Meta's resumable upload API, builds the Meta payload (`TemplatePayloadBuilder`) and POSTs it. The row is `pending` with a `meta_template_id`. The detail page polls Meta every 30s; Meta webhooks (`message_template_status_update`, `message_template_quality_update`, `template_category_update`, `message_template_components_update`) and an opportunistic sweeper mirror the verdict into `meta_status`, `status`, `quality_score`, `rejection_reason_code`, `paused_until`. Once APPROVED the template appears in every send picker (engine-aware `approved()` scope), variables are resolved per recipient (contact field, custom attribute, workspace attribute, system token, in that order), per-send overrides can shadow the mapping, and `TemplateSender` enforces the ban-prevention gates (approved, not paused, quality not RED, optional daily cap) before posting to Graph.

How plan tiers change it: plan feature `template` (boolean) gates creation and the nav item; `template_limit` caps the number of `wa_templates` rows owned by a workspace (NULL/0 = unlimited; platform admins bypass). Plan flag `access_carousel_templates` exists on packages but is NOT enforced anywhere in the template code (see Open questions). Pay-per-message / BSP workspaces additionally see a per-template cost chip and a pricing banner on the library.

Connections to other domains: `whatsapp-cloud-api-waba` (WABA: provider configs, credentials, Graph version, `LinkTracker`, `MetaError`, `WabaIdBackfiller`, webhook receiver `WaWebhookController` that calls the template-lifecycle handler documented here), `whatsapp-devices-baileys` (WADEV: Baileys senders), `node-bridge-runtime` (NODE: `templates-camp/{id}` blob, Node formatter), `contacts-attributes-tags` (CON: attributes catalog `/attributes/api/list`, `AttributeResolver`, `attribute-picker.js`, `Contact` fields used as variables), `broadcasts` (BCAST: `varsForRecipient()` lives in `BroadcastsController` and is reused by Team Inbox), `campaigns` (CAMP: `wpcampaigns.template_id/_a/_b/_overrides`), `scheduled-queue-warmer` (SCHED), `chat-conversations` / `team-inbox-conversations` (CHAT/TIB1: template pickers and template send), `flow-builder-editor` / `flow-runtime-engine` (FLB/FLR: template node, `/templates/api/list`), `auto-reply-keywords` (AR: template reply type), `appointments-booking` (APPT: `booking_templates.wa_template_id`), `invoicing` (INV: `InvoiceTemplateProvisioner` creates a WABA utility template), `plans-subscriptions-trials` (PLAN: `PlanLimitGuard`), `wallet-message-billing` (WALLET: cost chip via `MessageCreditRate`), `ai-keys-usage-admin` (AIADM: keys used by "Build with AI"), `developer-rest-api-v1` (API), `mobile-app-api` (MOB), `chrome-extension-sheets-addon` (EXT), `notifications-activity-audit` (NOTIF: `LogsNotifications` trait), `platform-settings-branding-storage` (SET: media disk/URL helpers, `waba_*` settings UI), `channel-facebook`/`channel-telegram`/`channel-line`/`channel-wechat`/`channel-viber`/`channel-sms`/`channel-instagram` (local-channel templates).

Two shape conventions coexist and must both be supported when porting: WABA/standard rows use lowercase button types `visit_website | quick_reply | call_phone | copy_code | catalog | otp_one_tap | otp_copy` with `value`, while local-DM rows (Instagram/Telegram seeders and Instaflow sync) use Meta-style uppercase `URL | QUICK_REPLY | PHONE_NUMBER` with `url`. `WaTemplate::buttonSubType()` is the single alias table for send-time behavior.

## Feature index

| Id         | Feature                                                                         | Status      | Priority | Effort | Depends on                         |
| ---------- | ------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------- |
| WD-TPL-001 | Template library page with filters, counts and pagination                       | implemented | P0       | M      | WD-TPL-002, WD-TPL-004             |
| WD-TPL-002 | Channel/engine model and per-channel visibility gates                           | implemented | P0       | M      | -                                  |
| WD-TPL-003 | Library card, WhatsApp-style preview mock and badges                            | implemented | P1       | S      | WD-TPL-001                         |
| WD-TPL-004 | Status model covering local, Meta and effective status                          | implemented | P0       | S      | -                                  |
| WD-TPL-005 | New-template modal (channel + format chooser)                                   | implemented | P1       | S      | WD-TPL-002                         |
| WD-TPL-006 | Create form shell for identity, channel, WABA account, Twilio SID and languages | implemented | P0       | M      | WD-TPL-002                         |
| WD-TPL-007 | Create pipeline (POST /templates)                                               | implemented | P0       | L      | WD-TPL-006, WD-TPL-008, WD-TPL-046 |
| WD-TPL-008 | Placeholder normalization and variable_map derivation                           | implemented | P0       | M      | -                                  |
| WD-TPL-009 | Header text, media attachment and location header                               | implemented | P0       | M      | WD-TPL-007                         |
| WD-TPL-010 | Buttons editor and button persistence                                           | implemented | P0       | M      | WD-TPL-007                         |
| WD-TPL-011 | Carousel templates                                                              | implemented | P1       | L      | WD-TPL-007                         |
| WD-TPL-012 | Catalog templates (WABA only)                                                   | implemented | P2       | M      | WD-TPL-007                         |
| WD-TPL-013 | Authentication (OTP) templates and code expiry                                  | partial     | P1       | M      | WD-TPL-007                         |
| WD-TPL-014 | Variable mapping panel and slash attribute picker                               | implemented | P1       | M      | WD-TPL-008                         |
| WD-TPL-015 | Live preview and client-side authoring guards                                   | implemented | P1       | M      | WD-TPL-006                         |
| WD-TPL-016 | Build with AI                                                                   | implemented | P2       | M      | WD-TPL-006                         |
| WD-TPL-017 | Template detail page and Meta review status                                     | implemented | P0       | M      | WD-TPL-004                         |
| WD-TPL-018 | Edit template (PUT /templates/{id})                                             | implemented | P0       | M      | WD-TPL-007                         |
| WD-TPL-019 | Push edits of a live template to Meta                                           | implemented | P1       | M      | WD-TPL-018, WD-TPL-025             |
| WD-TPL-020 | Delete template (local + Meta)                                                  | implemented | P0       | S      | WD-TPL-004                         |
| WD-TPL-021 | Manual approve / reject endpoints                                               | partial     | P2       | S      | WD-TPL-004                         |
| WD-TPL-022 | JSON helper endpoints for list, show and preview                                | implemented | P1       | S      | WD-TPL-004                         |
| WD-TPL-023 | Pre-submit linter                                                               | implemented | P0       | L      | -                                  |
| WD-TPL-024 | Meta create-payload builder                                                     | implemented | P0       | L      | WD-TPL-023                         |
| WD-TPL-025 | Submit to Meta (initial and retry) with media upload                            | implemented | P0       | L      | WD-TPL-023, WD-TPL-024             |
| WD-TPL-026 | Per-template status refresh and detail-page polling                             | implemented | P0       | S      | WD-TPL-025                         |
| WD-TPL-027 | Stale-status sweep and opportunistic import on library load                     | implemented | P1       | M      | WD-TPL-026                         |
| WD-TPL-028 | Sync from Meta (template importer)                                              | implemented | P0       | L      | WD-TPL-025                         |
| WD-TPL-029 | Template lifecycle webhooks (status, quality, category, components)             | implemented | P0       | M      | WD-TPL-025                         |
| WD-TPL-030 | Quality score, auto-pause and RED gate                                          | implemented | P0       | S      | WD-TPL-029                         |
| WD-TPL-031 | Twilio Content SID templates                                                    | partial     | P1       | S      | WD-TPL-007                         |
| WD-TPL-032 | Instagram templates with Instaflow sync and push                                | partial     | P2       | M      | WD-TPL-007                         |
| WD-TPL-033 | Template send gates and single send (TemplateSender send)                       | implemented | P0       | L      | WD-TPL-004, WD-TPL-030             |
| WD-TPL-034 | Send-time payload construction (buildSend)                                      | implemented | P0       | L      | WD-TPL-033                         |
| WD-TPL-035 | Header media resolution and upload at send time                                 | implemented | P1       | M      | WD-TPL-033                         |
| WD-TPL-036 | Parallel batch send (sendMany)                                                  | implemented | P1       | M      | WD-TPL-033                         |
| WD-TPL-037 | Per-recipient variable resolution                                               | implemented | P0       | L      | WD-TPL-008                         |
| WD-TPL-038 | Send-time overrides with resolver, sanitizer and storage                        | implemented | P1       | L      | WD-TPL-037                         |
| WD-TPL-039 | Send-time mapping panel and sendMeta contract                                   | implemented | P1       | L      | WD-TPL-038                         |
| WD-TPL-040 | Template data blob for the Node bridge and scheduler                            | implemented | P0       | M      | WD-TPL-037                         |
| WD-TPL-041 | Sendable-template pickers for other domains                                     | implemented | P0       | M      | WD-TPL-004                         |
| WD-TPL-042 | Single-recipient template send API                                              | implemented | P1       | M      | WD-TPL-033                         |
| WD-TPL-043 | REST API v1 template CRUD                                                       | implemented | P1       | M      | WD-TPL-007                         |
| WD-TPL-044 | Mobile app template API                                                         | implemented | P1       | M      | WD-TPL-007                         |
| WD-TPL-045 | Template button-click analytics sync                                            | implemented | P2       | M      | WD-TPL-025                         |
| WD-TPL-046 | Plan gating and limits for templates                                            | implemented | P0       | S      | -                                  |
| WD-TPL-047 | Global starter library seed                                                     | implemented | P1       | S      | -                                  |
| WD-TPL-048 | Platform flags and settings for templates                                       | partial     | P0       | S      | -                                  |
| WD-TPL-049 | Legacy chat_templates snippets                                                  | dead-code   | P2       | S      | -                                  |
| WD-TPL-050 | Change notifications on template writes                                         | implemented | P2       | S      | -                                  |

## Features

### WD-TPL-001 — Template library page with filters, counts and pagination

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-002, WD-TPL-004
- **Summary:** The "Template library" page (`/templates`) lists the workspace's templates plus the admin-seeded starter library as a card grid with category tabs, status sidebar, channel tabs, WhatsApp-number filter, sort, live search and 8-per-page pagination. Every filter change re-fetches a JSON partial instead of reloading.
- **Actors & access:** Workspace owner/admin/manager (`workspace.role:manager`; agents and viewers are redirected to `/team-inbox` with a warning; platform admins bypass). No per-route plan gate (the plan feature `template` only hides the nav item and gates creation). Workspace scoped through the user's `current_workspace_id`.
- **UX & screens:** `resources/views/user/templates/index.blade.php` + `_cards.blade.php`, JS `resources/js/charts/user-templates-index.js`.
  - Left rail: a side tip, a "Campaigns" link group (Campaign Overview, collapsible "Template Messages" with Template Library + WhatsApp, Scheduled Campaigns, Performance, Drafts), a Status block (All / Approved / In review / Rejected, each with a live count) and a "Quick start" card linking to Meta's template guidelines.
  - Header: title "Template library", buttons "Sync from Meta" (only when the workspace has any provider=`waba` config, see WD-TPL-028), "Sync from <Instaflow brand>" (only in remote-Instaflow mode, see WD-TPL-032) and "New Template Message" (opens WD-TPL-005 modal). Flash banners: success/status, and a red "Sync from Meta failed" banner for the `meta` error bag.
  - Channel pill strip (All channels / WhatsApp / Instagram / Facebook / Telegram) rendered ONLY if at least one Instagram, Facebook or Telegram template exists; each pill shows its count.
  - Category underline tabs: "All" plus one tab per Meta category (Marketing, Utility, Authentication) that has count > 0; unknown keys would be title-cased. WABA-number `<select>` ("All numbers") shown only when the workspace has more than one WABA config; the label is the config phone number, else Meta `display_phone_number`, else display label, else `WABA #id`. Sort select (Newest, Oldest, Name A-Z, Name Z-A) and a search box (debounced 220 ms).
  - Footer strip "Showing X of Y filtered templates" with a legend (hidden when total = 0). A message-pricing banner (`x-message-pricing`) appears only when the workspace is billed per message (see WD-TPL-003). Three static help cards ("What is a template message?", etc.).
  - Empty state: message "No templates match the current filters..." with Reset (link to `/templates`) and a "Create template" button that opens the type modal.
  - Behavior: the URL is kept in sync with `history.pushState` (category, status, channel, q, sort, page; defaults omitted), `popstate` re-fetches. The grid dims (opacity 60%) while loading; a toast "Refreshed" is suppressed for silent fetches; failures toast "Could not refresh: ...". On load and whenever the tab becomes visible again the page fires the sweep in WD-TPL-027.
- **Endpoints:**
  | METHOD uri             | route name              | Controller@action               | middleware                                | request fields                                                                                                                                                                                                                                                              | response                                                                                                                                                                 |
  | ---------------------- | ----------------------- | ------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | GET templates          | user.templates.index    | TemplatesController@index       | Authenticate, EnsureWorkspaceRole:manager | `category` (all/marketing/utility/authentication), `status` (all/approved/pending/rejected), `channel` (all/whatsapp/instagram/facebook/telegram/line/wechat/viber), `q`, `sort` (newest/oldest/name-asc/name-desc), `my` (bool), `provider_config_id`, `page`, `partial=1` | HTML page, or JSON when `wantsJson` or `partial=1`: `{ok, cards (HTML), categoryCounts, statusCounts, channelCounts, totalCount, pagination (HTML), shown, total, page}` |
  | GET templates/approved | user.templates.approved | TemplatesController@approved    | same                                      | forces `status=approved` then runs index                                                                                                                                                                                                                                    | same as index                                                                                                                                                            |
  | GET templates/pending  | user.templates.pending  | TemplatesController@pending     | same                                      | forces `status=pending`                                                                                                                                                                                                                                                     | same                                                                                                                                                                     |
  | GET templates/rejected | user.templates.rejected | TemplatesController@rejected    | same                                      | forces `status=rejected`                                                                                                                                                                                                                                                    | same                                                                                                                                                                     |
  | GET templates/mine     | user.templates.mine     | TemplatesController@myTemplates | same                                      | forces `my=1`                                                                                                                                                                                                                                                               | same                                                                                                                                                                     |
- **Data:** reads `wa_templates` (all text columns are encrypted at rest, so name search and name sorting are done in PHP after hydration), `wa_provider_configs` (WABA numbers, live-provider filter), `workspace_ig_accounts` / `facebook_pages` / `telegram_bots` / `line_channels` / `wechat_channels` / `viber_channels` (channel availability), `system_settings` (`facebook_enabled`, `telegram_enabled`, `line_enabled`, `wechat_enabled`, `viber_enabled`, `instagram_enabled`). Ordering: base query `id DESC`, then re-sorted in memory: newest/default = `created_at` desc, oldest = `created_at` asc, name sorts case-insensitive on the decrypted name.
- **Rules & edge cases:**
  1. Visibility set (before filters): (a) rows with `workspace_id` = the user's workspace, plus (b) the admin-seeded GLOBAL pool (`workspace_id IS NULL AND user_id IS NULL`). The global pool is restricted to sendable rows: on a WABA workspace only rows with `meta_template_id` set and `meta_status = APPROVED`; otherwise `status IN (approved, public)`. This stops other tenants' rows from leaking into a fresh account. With `my=1` only `forCurrentWorkspace()` rows are used (workspace rows + globals + legacy user-owned NULL-workspace rows).
  2. `providerLive` filter: rows whose `provider_config_id` points at a disconnected or deleted WABA config are hidden (rows with NULL `provider_config_id` are always kept). They are not deleted and reappear on reconnect.
  3. Channel gates (WD-TPL-002) remove Instagram/Facebook/Telegram/LINE/WeChat/Viber rows when that channel is not available; SMS rows are never filtered and count under "whatsapp".
  4. Category filter compares `meta_category` exactly (lowercase). Rows with NULL `meta_category` (for example templates created through the API with an industry category) show only under "All".
  5. Status filter: on a WABA-default workspace it compares the EFFECTIVE status (WD-TPL-004); otherwise it compares local `status` exactly (so `public` rows do not match `approved` in the filter, although they are counted as approved in the sidebar count).
  6. Counts (`categoryCounts`, `statusCounts`, `channelCounts`, `totalCount`) are computed over the full visible set BEFORE category/status/channel/search/WABA-number filters, so they do not change as filters change; `shown`/`total` reflect the filtered set.
  7. Pagination is in-memory, 8 per page, page number clamped to 1..last page; the JSON carries a rendered pagination partial whose links carry `data-tpl-page`.
  8. `canImportMeta` is true whenever ANY provider=`waba` config exists in the workspace (not gated on the default engine).
  9. Search: case-insensitive `contains` on the decrypted template name only (body is not searched).
  10. The `channel=whatsapp` filter means "everything that is not instagram/facebook/telegram/line/wechat/viber".
- **Async & events:** page-load AJAX `POST templates/sync-stale` (WD-TPL-027). No queue work.
- **External systems:** none on this request.
- **Settings:** `facebook_enabled`, `telegram_enabled`, `line_enabled`, `wechat_enabled`, `viber_enabled` (default false), `instagram_enabled`; workspace `enabled_engines`; pay-per-message switch (WALLET).
- **Acceptance criteria:**
  - Given a manager of a Baileys workspace with 3 own templates and 12 seeded global starters (8 approved), When they open `/templates`, Then they see their 3 rows plus the approved/public globals (pending/rejected globals are hidden), sorted newest first, 8 per page.
  - Given a WABA workspace, When the library loads, Then a global starter without `meta_template_id` is not listed and status counts use Meta's verdict when present.
  - Given the user types "welcome" in search, When 220 ms pass, Then only rows whose decrypted name contains "welcome" show and counts in the sidebar stay unchanged.
  - Given a WABA config was disconnected, When the library loads, Then templates attached to it are hidden and come back after reconnect without any data change.
  - Given an agent-role user, When they request `/templates`, Then they are redirected to `/team-inbox` with a role warning.
  - Given `?partial=1&status=pending&page=2`, When requested, Then the JSON contains `page: 2` (or the last page if fewer) and a pagination HTML fragment.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (index, scopedIndex, applySort, categoryCounts, statusCounts), `app/Models/WaTemplate.php` (scopes), `resources/views/user/templates/index.blade.php`, `resources/views/user/templates/_cards.blade.php`, `resources/js/charts/user-templates-index.js`, `routes/web.php` (lines ~795-835), `app/Http/Middleware/EnsureWorkspaceRole.php`, `app/Http/Controllers/Controller.php` (paginateCollection).
- **Port notes:** New `apps/api/src/modules/templates` with a tenant-scoped query (Postgres RLS on `workspace_id`; the global starter pool needs an explicit RLS policy for `workspace_id IS NULL`). Do NOT port the encrypted-columns-then-filter-in-PHP design blindly: store plain columns (encrypt only if required) and do search/sort in SQL with a real pagination cursor. Keep the counts-ignore-filters behavior. `apps/web/app/(app)/templates/page.tsx` with URL-synced filters.

### WD-TPL-002 — Channel/engine model and per-channel visibility gates

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** -
- **Summary:** Every template row belongs to one channel (engine). The channel decides how it is created (Meta submit vs auto-approved), how it is labeled, whether it is listed, and who can send it. Non-WhatsApp channels only appear while they are usable ("no dead channel" rule).
- **Actors & access:** Same as library. Availability is computed per request from workspace engine settings and connected accounts.
- **UX & screens:** Engine chip on each card (Unofficial, Meta WABA, Twilio, Instagram, Facebook; other channels fall back to "Unofficial" styling), channel picker on the create form (WD-TPL-006), channel tabs on the library (WD-TPL-001).
- **Endpoints:** none of its own (consumed by `GET templates`, `GET templates/create`, `POST templates`).
- **Data:** `wa_templates.channel` varchar(16) nullable (`baileys|waba|twilio|instagram|facebook|telegram|line|wechat|viber`; `sms` is accepted on create but has no branch in `engineKey()`), `provider_config_id`, `meta_template_id`, `twilio_content_sid`. Migration `2026_06_16_000100` added `channel` and back-filled it: twilio SID present -> `twilio`; `meta_template_id` or `provider_config_id` present -> `waba`; else `baileys`.
- **Rules & edge cases:**
  1. `WaTemplate::engineKey()`: returns `channel` when it is one of baileys/waba/twilio/instagram/facebook/telegram/line/wechat/viber; otherwise derives (twilio SID -> twilio; `meta_template_id` or `provider_config_id` -> waba; else baileys). A row with `channel='sms'` therefore resolves to `waba` if it has a provider id, else `baileys` (QUIRK: SMS rows are labelled "Unofficial").
  2. `engineLabel()` (user-facing text, never says "Baileys"): Unofficial API, Meta (WABA), Twilio, Instagram, Facebook, Telegram, LINE, WeChat, Viber.
  3. Availability of WhatsApp engines for authoring: `WorkspaceEngine::availableFor(workspace)` = platform `allowed_send_methods` (minus `meta_ads`) intersected with the workspace's `enabled_engines` JSON (empty = no restriction), default engine first; falls back to the default engine when empty. The default engine is `WorkspaceEngine::for()` (primary provider config, else platform default).
  4. Extra channels are appended to the available list only when: Instagram: at least one `workspace_ig_accounts` row connected; Facebook: `facebook_enabled` AND `FacebookPage::hasConnected`; Telegram: `telegram_enabled` AND `TelegramBot::hasConnected`; LINE: `line_enabled` AND `LineChannel::hasConnected`; WeChat: `wechat_enabled` AND `WeChatChannel::hasConnected`; Viber: `viber_enabled` AND `ViberChannel::hasConnected`; SMS: `sms_enabled` AND a connected provider=`sms` config.
  5. Library filtering uses the same gates for instagram/facebook/telegram/line/wechat/viber (not SMS). Rows are hidden, never deleted, so they return when the channel comes back.
  6. On WABA-default workspaces the "public pool" of globals requires a real Meta approval (`meta_template_id` + `meta_status=APPROVED`); on other engines the local `status` decides. Local rows created on non-WABA channels also receive a synthetic `meta_status=APPROVED` and `approved_at` (QUIRK: `meta_status` is not proof of Meta approval; `meta_template_id IS NOT NULL` is the only trustworthy signal; see WD-TPL-041).
  7. Twilio field visibility uses `WorkspaceEngine::isEngineEnabled(ws,'twilio')` (multi-engine aware).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `allowed_send_methods`, per-workspace `enabled_engines`, `<channel>_enabled` system settings, `sms_enabled`.
- **Acceptance criteria:**
  - Given Facebook is enabled system-wide but the workspace has no connected Page, When the library loads, Then Facebook templates are hidden from list, counts and tabs.
  - Given a workspace with engines [waba, baileys], When the create form loads, Then both channels are offered with the default engine first.
  - Given a row with `channel=null`, `meta_template_id` set, When shown, Then it is labelled Meta (WABA).
  - Given a posted channel that is not in the available list, When a template is created, Then the server silently replaces it (WD-TPL-007 rule 2).
- **Source refs:** `app/Models/WaTemplate.php` (engineKey, engineLabel), `app/Services/WorkspaceEngine.php`, `app/Http/Controllers/TemplatesController.php` (index, create, store), `database/migrations/2026_06_16_000100_add_channel_to_wa_templates.php`.
- **Port notes:** model channel as an enum column with a CHECK constraint (`whatsapp_cloud`, `whatsapp_unofficial`, `twilio`, `instagram`, ...). Availability = a service method `availableChannels(workspaceId)` shared by list and create. Keep "hide, don't delete" semantics. Fix the SMS label gap.

### WD-TPL-003 — Library card, WhatsApp-style preview mock and badges

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TPL-001
- **Summary:** Each template renders as a card that mimics a WhatsApp bubble (media placeholder, header, formatted body, footer, up to 3 button rows) with category, engine, status, type, WABA-number and optional cost badges plus Edit / View / Delete actions.
- **Actors & access:** Same as library.
- **UX & screens:** `resources/views/user/templates/_cards.blade.php`.
  - Title row: template name and a category chip (`meta_category`, falling back to the local vertical) colored per category (marketing coral, authentication blue, utility mint, verticals have their own colors).
  - Meta row: engine chip; status dot + label (Approved, Public, In review, Rejected; unknown = capitalized); template type; Meta category; for WABA rows the account label (`display_label` or phone number or "WABA"); a cost chip `Free` or `<price>/msg` for engines waba/baileys/twilio ONLY when the workspace is billed per message (uses `MessageCreditRate::displayForCategory(effectiveCategory())`, tooltip "Cost per delivered message - base rate, varies by recipient country").
  - Preview: media placeholder icon (image/video/document/location) when `attachment_type` is one of image, video, document, media, location; header text (limited to 90 chars) only when there is no media; body first 5 paragraphs (split on blank line), HTML-escaped, with `*bold*`, `_italic_`, `~strike~` converted and every `{{token}}` shown as a pill; footer (limited to 120 chars); fixed timestamp "10:30" with double tick; up to 3 buttons with an icon by type (URL, phone, generic) and "+N more".
  - Rejected rows with a `rejection_reason` show a red "Rejected: <reason>" strip (local rejection text, not Meta's code).
  - Actions: "Edit template" (`/templates/{id}/edit`), eye icon (detail page), trash (delete via JS confirm dialog "Delete "<name>"? This can't be undone.", then DELETE `/templates/{id}` and re-fetch).
- **Endpoints:** none of its own (rendered inside WD-TPL-001).
- **Data:** reads decrypted `template_name`, `header`, `template_body`, `footer`, `buttons`, `attachment_type`, `meta_category`, `category`, `status`, `rejection_reason`, `provider` relation.
- **Rules & edge cases:**
  1. `effectiveCategory()` = lowercase `meta_category` if non-empty else the local `category` ONLY when it is one of marketing/utility/authentication (the local `category` column is overloaded with business verticals such as travel or festival; a vertical resolves to "" so it is not filed under a WhatsApp category it never claimed).
  2. Button icon detection only understands uppercase `URL`/`PHONE_NUMBER` or a `url`/`phone_number` key; lowercase WABA types (`visit_website`, `call_phone`) therefore show the generic icon (cosmetic QUIRK).
  3. Cost chip is computed per card on the server (no N+1 concern in the port if rates are cached).
  4. The preview substitutes nothing: `{{1}}` and `{{name}}` are shown as pills.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** pay-per-message mode (WALLET) toggles the cost chip and banner.
- **Acceptance criteria:**
  - Given a template with an image header and 4 buttons, When rendered, Then the card shows the image placeholder, no header text, 3 button rows and "+1 more".
  - Given the body `Hi {{name}} *thanks*`, When rendered, Then "thanks" is bold and `{{name}}` is a pill; HTML in the body is escaped.
  - Given a classic-plan workspace, When cards render, Then no cost chip is shown; given a pay-per-message workspace, Then a WABA card shows the per-message price derived from its Meta category.
- **Source refs:** `resources/views/user/templates/_cards.blade.php`, `app/Models/WaTemplate.php` (effectiveCategory, getStatusLabelAttribute, engineLabel), `app/Services/MessageBillingService.php`, `app/Services/MessageCreditRate.php`.
- **Port notes:** a `TemplateCard` React component; share the WhatsApp-format renderer with the detail page and live preview (one implementation). Escape first, then format.

### WD-TPL-004 — Status model covering local, Meta and effective status

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** -
- **Summary:** Two parallel status columns exist. `status` (local: `pending|approved|rejected|public`) drives list filters and non-WABA sending; `meta_status` (Meta enum) is authoritative on WABA. A derived "effective status" keeps counts, filters and badges consistent.
- **Actors & access:** internal model behavior; visible in library and detail page.
- **UX & screens:** status dot/label on cards, sidebar Status block counts, detail-page pill.
- **Endpoints:** none.
- **Data:** `wa_templates.status` varchar(16) default `pending`; `meta_status` varchar(32) null; `quality_score` (UNKNOWN|GREEN|YELLOW|RED); `rejection_reason` (encrypted text, local human note); `rejection_reason_code` varchar(64) (Meta enum: ABUSIVE_CONTENT, INVALID_FORMAT, PROMOTIONAL, TAG_CONTENT_MISMATCH, SCAM, NONE); `approved_at`, `submitted_at`, `last_synced_at`, `paused_until`. Constants: STATUSES = pending/approved/rejected/public; META_STATUSES = PENDING, APPROVED, REJECTED, IN_APPEAL, PENDING_DELETION, DELETED, DISABLED, PAUSED, LIMIT_EXCEEDED, FLAGGED; META_QUALITY = UNKNOWN, GREEN, YELLOW, RED; PARAM_FORMATS = POSITIONAL, NAMED.
- **Rules & edge cases:**
  1. Label map (`status_label`): approved = Approved, public = Public, pending = "In review", rejected = Rejected.
  2. Effective status (WABA-default workspaces only): meta_status APPROVED AND `meta_template_id` set -> approved; PENDING or IN_APPEAL -> pending; REJECTED, DISABLED, PAUSED, LIMIT_EXCEEDED, FLAGGED -> rejected; anything else/empty -> fall back to local status (approved/public -> approved, rejected -> rejected, else pending). Non-WABA workspaces count by local `status` (approved counts approved + public).
  3. Sync mapping Meta -> local `status`: APPROVED -> approved; REJECTED -> rejected; PENDING/IN_APPEAL -> pending; every other Meta state leaves the local status unchanged (so a PAUSED/DISABLED template keeps reading "Approved" locally while `meta_status` and the send gate block it).
  4. Legacy migration `2026_05_24_040000` back-filled `meta_status` from local `status` for all existing rows (approved/public -> APPROVED, rejected -> REJECTED, pending -> PENDING). Consequently `meta_status=APPROVED` alone never proves Meta approval.
  5. Sendable predicate for WABA sends: `meta_status = APPROVED` AND not paused (`paused_until` null or past) AND quality not RED (`isMetaApproved()`, `isQualityHealthy()`); the list/picker scope additionally requires `meta_template_id IS NOT NULL`.
  6. `staleSweepTargets` scope: `meta_status = PENDING` AND `meta_template_id` set AND `submitted_at` older than 1 hour AND (`last_synced_at` null OR older than 30 minutes).
- **Async & events:** written by the webhook handler, the sweeper, the refresh endpoint, the importer and the submit action (see those features).
- **External systems:** Meta template status enum.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `meta_status=APPROVED` but `meta_template_id` null on a WABA workspace, When counts are computed, Then the row is not counted as approved (falls to local status rules).
  - Given a webhook event PAUSED, When applied, Then `meta_status=PAUSED`, `paused_until = now+24h` and local `status` is unchanged.
  - Given a template in status `public`, When counted on a non-WABA workspace, Then it counts under Approved.
- **Source refs:** `app/Models/WaTemplate.php`, `app/Http/Controllers/TemplatesController.php` (wabaEffectiveStatus, statusCounts), `app/Services/Waba/TemplateSyncSweeper.php`, `database/migrations/2026_05_24_040000_add_meta_columns_to_wa_templates.php`, `resources/views/user/templates/show.blade.php`.
- **Port notes:** model `local_status` and `meta_status` as enums; expose a single `effectiveStatus` computed in the API so the frontend never re-derives it. Keep `meta_template_id` UNIQUE (globally, see WD-TPL-028 rule on duplicate WABA connections) - in Postgres use a unique index on `(waba_account_id, meta_template_id)` plus a tenant-safe conflict policy.

### WD-TPL-005 — New-template modal (channel + format chooser)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TPL-002
- **Summary:** "New Template Message" opens a two-step modal: (1) pick a channel when a local-DM channel is available, (2) pick a WhatsApp format Standard, Carousel or Catalog. Each choice is a link to `/templates/create` with `?type=` or `?channel=`.
- **Actors & access:** manager+.
- **UX & screens:** modal `#type-modal` in `index.blade.php`. Step 1 (`#tpl-step-channel`) is rendered only if Instagram OR Facebook OR Telegram is connected: cards WhatsApp (leads to step 2), Instagram (`/templates/create?channel=instagram`), Facebook (`?channel=facebook`), Telegram (`?channel=telegram`). Step 2 (`#tpl-step-format`, with a Back link when step 1 exists): Standard (`?type=standard`), Carousel (`?type=carousel`, "up to 10 cards, image, title, body, 2 buttons"), Catalog (`?type=catalog`, "WhatsApp official numbers only"). Backdrop click and X close. The empty-state "Create template" button reopens the same modal at step 1.
- **Endpoints:** none (client-side navigation).
- **Data:** none.
- **Rules & edge cases:**
  1. LINE, WeChat, Viber and SMS templates have NO card in the modal although `create()` accepts `?channel=line|wechat|viber|sms` when the channel is available and the store pipeline supports them (QUIRK: reachable only by URL).
  2. The Catalog card is shown regardless of whether a WABA number is connected; the create page shows a warning banner instead (WD-TPL-012).
  3. There is no "media" or "authentication" format card (see WD-TPL-013).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** channel availability (WD-TPL-002).
- **Acceptance criteria:**
  - Given only WhatsApp is available, When the modal opens, Then it goes straight to the format step with no Back link.
  - Given Instagram is connected, When the modal opens, Then the channel step shows WhatsApp and Instagram cards.
  - Given the user picks Carousel, When they click the card, Then they land on `/templates/create?type=carousel` with the carousel section visible.
- **Source refs:** `resources/views/user/templates/index.blade.php` (type-modal).
- **Port notes:** replace with a Next.js dialog; add cards for every supported channel (LINE, WeChat, Viber, SMS) to remove the URL-only gap.

### WD-TPL-006 — Create form shell for identity, channel, WABA account, Twilio SID and languages

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-002
- **Summary:** `GET /templates/create` renders the shared builder form for standard, carousel, catalog and local-DM templates. This feature covers the identity section, channel picker, multi-WABA account picker, Twilio SID block, language list and the sticky action bar.
- **Actors & access:** manager+. Server passes `channels`, `defaultChannel`, `wabaConfigs`, `primaryWabaId`, `isTwilio`, `catalogProducts`.
- **UX & screens:** `resources/views/user/templates/create.blade.php`, JS `user-templates-create.js`. Sticky bar: back arrow, breadcrumb "Templates / New / <Format>", title, format pill (Standard/Carousel/Catalog), a "Draft / unsaved" pill, "Build with AI" (WD-TPL-016), "Save draft" (no handler, see quirk), and the submit button labelled "Submit for review" (WhatsApp) or "Save template" (Instagram/Facebook/Telegram).
  - Section 01 Identity: Template name (required, maxlength 60, live-sanitized to lowercase `a-z0-9_`, repeats collapsed and edges trimmed on blur; hint "a-z, 0-9, _ only / max 60"), Category select posting `meta_category` (Marketing / Utility default / Authentication, required; a hidden `category` field posts `utility`), Language select from `wa_template_languages()` (about 90 codes, `en_US` default, English (US), English (UK), English, Indonesian, ... alphabetical tail; the edit form keeps an unknown legacy code as an extra option). For local-DM channels the category and language blocks are hidden but still submit their defaults.
  - Send channel radio cards (Unofficial API "ready instantly, sent as text + buttons", Meta (WABA) "submitted to Meta for approval", Twilio "uses the Content SID below") appear only when more than one channel remains after removing instagram/facebook/telegram/sms (the local-DM channels are chosen in the modal); with a single channel a hidden `channel` input is posted. `?channel=` (validated against the available list) presets the default; otherwise the default is the workspace engine.
  - WABA account select (`provider_config_id`) appears only when more than one connected WABA exists; options "<label or WABA #id> . <phone>", pre-selected to the primary; hint explains that media and Meta submission must use the same WABA or Meta rejects with "Invalid parameter".
  - Twilio block (only when `twilio` is among available channels; hidden until the Twilio radio is checked): "Twilio Content SID" text input, pattern `HX[0-9a-fA-F]{32}`, maxlength 34, plus an amber note that content is authored in Twilio's builder. Choosing Twilio hides the entire builder and the preview column.
  - Catalog mode warning banner when `?type=catalog` and no WABA channel exists.
  - Error summary box lists every server validation error ("Could not save the template:").
- **Endpoints:**
  | METHOD uri           | route name            | Controller@action          | middleware                                | request fields                                | response  |
  | -------------------- | --------------------- | -------------------------- | ----------------------------------------- | --------------------------------------------- | --------- |
  | GET templates/create | user.templates.create | TemplatesController@create | Authenticate, EnsureWorkspaceRole:manager | `type` (standard/carousel/catalog), `channel` | HTML form |
- **Data:** reads `wa_provider_configs` (connected provider=waba rows: id, display_label, phone_number; primary id), `wa_products` (only for catalog: `meta_retailer_id` or `sku` or `wsn-<id>` as retailer id, name, image).
- **Rules & edge cases:**
  1. `template_type` hidden input = `request('type','standard')`; the form itself cannot switch format (no `media` or `auth` option).
  2. Catalog forces WABA-only: the channel picker is filtered to `waba` only.
  3. Local-DM channels (instagram/facebook/telegram) hide header, attachment, footer, category, language and variable panel; the body placeholder text changes per channel; preview chrome switches to an IG/Messenger/Telegram look.
  4. The `Save draft` button has no click handler and no route (dead UI; there is no draft concept, every save is a real row).
  5. Client-side name sanitizing is only cosmetic; the server does not enforce the `a-z0-9_` pattern on `template_name` (max 191); the Meta path slugifies later (WD-TPL-024).
  6. Body textarea has `maxlength=1024` and header/footer `maxlength=60`, while server validation allows body 4096 and header/footer 255 (server looser than UI and than Meta).
- **Async & events:** none until submit.
- **External systems:** none.
- **Settings:** `waba_templates_v2_enabled` decides the default channel fallback on submit (WD-TPL-007).
- **Acceptance criteria:**
  - Given a workspace with one connected WABA, When the form loads, Then no WABA picker is shown and a hidden `channel` is posted.
  - Given two connected WABAs, When the form loads, Then the picker is required and defaults to the primary.
  - Given the operator types "Spring Promo!", When focus leaves the field, Then the value becomes `spring_promo`.
  - Given the Twilio radio is selected, When the page updates, Then the builder and preview are hidden and only the Content SID input remains.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (create), `resources/views/user/templates/create.blade.php`, `resources/js/charts/user-templates-create.js`, `app/Support/fc_helpers.php` (`wa_template_languages`).
- **Port notes:** keep one builder component parameterized by format/channel; move the language list to a shared constant matching Meta's supported languages; add a real "save as draft" only if product wants it (it does not exist in WaDesk).

### WD-TPL-007 — Create pipeline (POST /templates)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TPL-006, WD-TPL-008, WD-TPL-046
- **Summary:** Server-side creation of a template from the builder form: plan checks, channel resolution, validation, normalization, media upload, persistence, and (for WABA) immediate lint + submit to Meta. Local channels are saved as approved.
- **Actors & access:** manager+; plan feature `template` and limit `template_limit` (platform admins bypass).
- **UX & screens:** the form of WD-TPL-006. Redirects: WABA -> template detail page with flash "Template "<name>" submitted for review." (or the `meta` error bag when the submit failed, the row is still saved); non-WABA -> library with flash "Template "<name>" saved successfully."
- **Endpoints:**
  | METHOD uri     | route name           | Controller@action         | middleware                                | request fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | response                 |
  | -------------- | -------------------- | ------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
  | POST templates | user.templates.store | TemplatesController@store | Authenticate, EnsureWorkspaceRole:manager | multipart: `template_name`, `category`, `meta_category`, `template_type`, `header`, `template_body`, `footer`, `code_expiration_minutes`, `buttons`, `carousel_data`, `variable_map`, `variable_map_json`, `attachment_type`, `attachment_file`, `language`, `status`, `twilio_content_sid`, `channel`, `provider_config_id`, `button_type[]`/`button_text[]`/`button_value[]`/`country_code[]`/`url_type[]`, `quick_reply[]`, `carousel_titles[]`/`carousel_bodies[]`/`carousel_images[i]`/`carousel_button_*[]`, `carousel_body`, `latitude`/`longitude`/`location_name`/`location_address`, `catalog_button_text`, `thumbnail_product_retailer_id` | 302 redirect (see above) |
- **Data:** writes `wa_templates` (all columns in Data model). Files go to `media_disk()` under `wa-templates/` (carousel cards under `wa-templates/carousel/`).
- **Rules & edge cases:**
  1. Plan gates first: `PlanLimitGuard::feature(ws,'template')`, then `PlanLimitGuard::check(ws,'template_limit', count of ALL wa_templates rows with this workspace_id)`; admin-seeded globals (NULL workspace) are not counted; imported Meta templates and non-WABA templates ARE counted. Failure throws `PlanLimitReachedException` (422 JSON or back-with-error).
  2. Channel resolution: the posted `channel` must be one of baileys, waba, twilio, instagram, facebook, telegram, line, wechat, viber, sms AND present in the available list (WD-TPL-002); otherwise it is replaced silently by `waba` when `waba_templates_v2_enabled` is on, else `baileys`. QUIRK: with the flag on and no WABA connected this default produces a `pending` WABA row whose submit fails.
  3. `template_type=catalog` forces `channel=waba` and `meta_category=marketing`.
  4. Validation (all others `sometimes`): `template_name` required|string|max:191; `category` in travel,healthcare,education,ecommerce,festival,finance,utility; `meta_category` nullable in marketing,authentication,utility; `template_type` in standard,carousel,media,auth,catalog; `header` nullable string max 255; `template_body` required string max 4096 (Twilio: optional); `footer` nullable max 255; `code_expiration_minutes` nullable integer 1..90; `buttons`, `carousel_data`, `variable_map` nullable array; `attachment_type` nullable in image,video,document,location,none; `attachment_file` file max 102400 KB (per-type cap enforced separately, WD-TPL-009); `language` string max 16; `status` in pending,approved,rejected,public; `twilio_content_sid` nullable, max 34, regex `^HX[0-9a-fA-F]{32}$`. Null values are dropped from the validated array (so nothing can be set to null by omission).
  5. Location header handled before normalization (WD-TPL-009). Named placeholders are normalized in header, body and footer (WD-TPL-008) and `AttributesController::validatePlaceholders` runs on each of them (numeric tokens must be 1-based and contiguous, else a field error "Variable placeholders must be 1-based and contiguous...").
  6. Non-Twilio channels null out any posted `twilio_content_sid`. A Twilio template with an empty body gets the placeholder body "Twilio template (content managed in Twilio Content Builder)."
  7. Stamps `user_id`, `channel`, `workspace_id`; `provider_config_id` is stored only if the posted id is a CONNECTED provider=waba config of this workspace.
  8. Status: `data.status` from the request wins, else `pending` for WABA and `approved` for everything else; non-WABA rows also get `meta_status=APPROVED` and `approved_at=now` (synthetic approval).
  9. Type branches: carousel -> WD-TPL-011; catalog -> WD-TPL-012; standard -> buttons (WD-TPL-010) if `button_type` or `quick_reply` present (a raw posted `buttons` array is otherwise stored as-is, unsanitized and uncapped, QUIRK), attachment file with per-type size check and MIME-based `attachment_type` (WD-TPL-009).
  10. `variable_map` derived per WD-TPL-008 (only stored when non-empty).
  11. After `WaTemplate::create`, Instagram rows are pushed to Instaflow best-effort (WD-TPL-032). WABA rows run `submitToMeta` (WD-TPL-025); a failure redirects to the detail page with the error but keeps the row for retry.
  12. Duplicate names are not checked locally (encrypted column, no unique index); Meta reports duplicates (error 132007 "Template name already exists for a different language").
  13. Race/idempotency: none; double submit creates two rows and two Meta calls (second fails on duplicate name).
- **Async & events:** synchronous Meta HTTP calls inside the request (media upload + create); `LogsNotifications` records a "created" notification (WD-TPL-050). No queue.
- **External systems:** Meta Graph `POST /{waba_id}/message_templates`, `POST /{app_id}/uploads` (WD-TPL-025). Instaflow (optional).
- **Settings:** `waba_templates_v2_enabled`, `waba_graph_api_version` (default `v23.0`), `waba_app_id`; package `template`, `template_limit`.
- **Acceptance criteria:**
  - Given a plan with `template_limit=5` and 5 existing workspace templates, When a manager submits the form, Then a limit error is shown and no row is created.
  - Given channel=baileys, When the template is saved, Then the row has `status=approved`, `meta_status=APPROVED`, `approved_at` set and the user lands on the library with the success flash.
  - Given channel=waba with a lint error, When submitted, Then the row exists as `pending` with no `meta_template_id`, and the detail page shows "Meta submission failed" with the bullet list of lint errors.
  - Given a body `Hi {{first_name}}, order {{order_id}} ready`, When saved, Then the stored body is `Hi {{1}}, order {{2}} ready` and `variable_map.body = [{num:1,key:first_name},{num:2,key:order_id}]`.
  - Given a non-connected `provider_config_id` is posted, When saved, Then it is ignored and the primary WABA is used at submit.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (store, validateTemplate, processButtons, processCarouselData, resolveAttachmentType, assertMediaSize, submitToMeta), `app/Services/PlanLimitGuard.php`, `app/Http/Controllers/AttributesController.php` (validatePlaceholders).
- **Port notes:** API `POST /v1/templates` (multipart). Do the lint + Meta submit in a BullMQ job with a "submitting" state instead of holding the HTTP request; record the outcome on the row (`submit_error`). Enforce plan limits transactionally. Emit an outbox event `template.created`. Tenant id from the session, never from the payload.

### WD-TPL-008 — Placeholder normalization and variable_map derivation

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** -
- **Summary:** Operators author named tokens (`{{first_name}}`); storage and Meta submission are always positional (`{{1}}`, `{{2}}`). The server rewrites tokens on save and records which contact attribute fills each slot in `variable_map`.
- **Actors & access:** internal; runs on create, edit and API create.
- **UX & screens:** the body/header inputs and the variable-mapping panel (WD-TPL-014). The edit form rewrites stored positional tokens back to their mapped key for display only.
- **Endpoints:** part of `POST templates` and `PUT templates/{id}`.
- **Data:** `wa_templates.variable_map` (encrypted array). Stored shape: `{ "header": [{num, key}], "body": [{num, key}], "cards": {idx: {body: [...]}} (never written by the UI), "url_<i>": [example] (never written by the UI) }`. `num` is the 1-based slot, `key` an attribute key or the literal slot number when unmapped.
- **Rules & edge cases:**
  1. `normalizePlaceholders`: regex `{{ token }}` where token is `[a-zA-Z0-9_]+`; each DISTINCT token receives a 1-based number in order of first appearance, per field (header, body and footer are normalized independently and each starts at 1). Idempotent for `{{1}}{{2}}`; a body `{{2}} {{1}}` becomes `{{1}} {{2}}` (renumbered by appearance). Tokens containing spaces, dots or hyphens (e.g. `{{Phone Number}}`) are NOT normalized and remain literal (QUIRK, see WD-TPL-037 for how send handles them).
  2. `validatePlaceholders`: only numeric tokens are checked (1-based contiguous after de-dup); runs after normalization so it only catches malformed leftovers.
  3. `buildVariableMapForSave` picks the source: if the RAW (pre-normalization) header or body contains a named token (`{{ [a-zA-Z_][\w.-]* }}`), the map is derived from the raw text (each distinct token -> `{num: appearance index, key: token name}`, numeric tokens in a mixed body map to their own number); otherwise it defers to `buildVariableMapFromRequest`, which reads the hidden `variable_map_json` (`{slot: attribute_key}`) and, per field, lists the positional slots present in that field's text with the mapped key or the literal slot number for unmapped slots; malformed or absent JSON falls back to `buildVariableMap` (name derivation from `{var}` / `{{var}}` regex, single or double braces).
  4. QUIRK: in the named branch the JSON from the mapping panel is ignored, so re-pointing a named token to a different attribute in the panel has no effect; header and body share one JSON slot namespace in the legacy branch even though each field numbers from 1.
  5. `variable_map` is only overwritten when the result is non-empty, so removing all variables on edit leaves the previous map in place.
  6. Legacy fix: migration `2026_05_24_060000` rebuilt `variable_map` for all rows created before double-brace tokens were recognized (their empty maps caused Meta #132000 on every broadcast recipient).
  7. Named tokens support letters, digits, underscore in normalization but the map builders accept dots and hyphens; `parameter_format` remains `POSITIONAL` (default) for every locally created template; `NAMED` only appears through Meta import.
- **Async & events:** none.
- **External systems:** Meta requires positional placeholders in `POSITIONAL` mode; named tokens fail the whole create.
- **Settings:** none.
- **Acceptance criteria:**
  - Given header `Hi {{name}}` and body `{{name}}, code {{code}}`, When saved, Then header=`Hi {{1}}`, body=`{{1}}, code {{2}}` and the map has header `[{1,name}]`, body `[{1,name},{2,code}]`.
  - Given body `Hello {{2}}` only, When saved, Then it is renumbered to `Hello {{1}}`.
  - Given a legacy positional body `Hi {{1}}` and `variable_map_json {"1":"first_name"}`, When saved, Then body map is `[{1,first_name}]`.
  - Given tokens `{{1}}` and `{{3}}`, When validated without normalization, Then the contiguity error is returned.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (normalizePlaceholders, buildVariableMap, buildVariableMapFromRequest, buildVariableMapForSave), `app/Http/Controllers/AttributesController.php`, `database/migrations/2026_05_24_060000_backfill_wa_templates_variable_map.php`.
- **Port notes:** put normalization + map derivation in a pure `template-variables` library shared by API and web (and unit-test with the cases above). Consider storing the map as `{slot -> attributeKey}` per section; keep the shape read-compatible with the importer and payload builder (`num`/`key` objects).

### WD-TPL-009 — Header text, media attachment and location header

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-007
- **Summary:** A standard template can carry a text header, OR one media header (image, video, document) with a sample file, OR a location pin. Media is stored on the configured media disk and later uploaded to Meta as a resumable "header handle".
- **Actors & access:** manager+ (web), same for API/mobile with narrower options (WD-TPL-043/044).
- **UX & screens:** Header section (Type select Text/None, "Header text" max 60, supports one variable) and Attachment section (type select None/Image/Video/Document/Location, "Sample file" tile "Choose sample file" with size hint "Image <= 5MB . Video <= 16MB . PDF <= 100MB", live preview of the picked file; Location shows four inputs latitude, longitude, place name (max 100), address (max 200) and a map-pin preview). Both sections are hidden for local-DM channels and for catalog. The edit form shows the existing file name, "tap to replace", and a hidden `existing_attachment_file` field that the server never reads.
- **Endpoints:** part of `POST templates` and `PUT templates/{id}`.
- **Data:** `wa_templates.header` (encrypted), `attachment_type` varchar(16) (`none|image|video|document|location`, plus `audio` when a file's MIME is audio, and `media`/`text` in legacy rows), `attachment_file` varchar(255) (disk-relative path `wa-templates/<random>.<ext>`), `header_location` (encrypted array `{latitude, longitude, name?, address?}`), `header_sample_url` text (Meta's approved sample URL captured at import, migration `2026_07_16_000100`).
- **Rules & edge cases:**
  1. `attachment_type` is set from the UPLOADED file's MIME (`image/*` -> image, `video/*` -> video, `audio/*` -> audio, else document), overriding the select; if no file is uploaded the posted select value is stored as is.
  2. Size caps (MB): image 5, video 16, document 100, audio 16; violation returns a field error "This <type> is X.YMB - WhatsApp only accepts up to N MB for a <type>. Please upload a smaller file." The validator's hard ceiling is 100 MB for any file.
  3. Location: only honored when the attachment select is `location`; `latitude` -90..90 and `longitude` -180..180 must be numeric else error "Enter a real latitude (-90 to 90) and longitude (-180 to 180). Example: 19.0760, 72.8777" (WhatsApp silently renders 0,0 for out-of-range values); stores `header_location` and nulls `attachment_file`. Non-location submissions clear `header_location` on create; on update the pin is cleared whenever `attachment_type` is present and not `location`.
  4. On Meta build, the header format comes from `attachment_type` (IMAGE, VIDEO, DOCUMENT, LOCATION, else TEXT; AUDIO falls back to TEXT). A media header supplies `example.header_handle` from the resumable upload; text header with a placeholder supplies `example.header_text` (from `variable_map.header`, else the placeholder name, else "Sample").
  5. If a media file is attached, header TEXT is ignored by the Meta builder (the type wins), and the card preview hides header text when media is present.
  6. Linter: `attachment_type` set (not none) with no `attachment_file` is an error "Header is set to <type> but no file was attached" - QUIRK: this also blocks WABA submission of a LOCATION-header template, because location templates never have a file; location templates therefore only work on non-WABA channels in practice (and WABA build would also send an empty `header_handle` for LOCATION).
  7. Header text: server max 255, linter/Meta max 60 and at most one placeholder.
  8. Media deleted from storage: submit returns "Header media file is missing from storage. Re-upload it, then submit again."; cloud disks are streamed to a temp file and removed after upload.
  9. The web delete path does not remove stored media (the mobile API does); replaced files on edit are not deleted either (orphan files).
- **Async & events:** media upload to Meta happens during submit (WD-TPL-025).
- **External systems:** Meta resumable upload (`POST /{app_id}/uploads`, then `POST /{session}` with binary and `Authorization: OAuth <token>`, header `file_offset: 0`).
- **Settings:** media disk (`media_disk()`), public URL builder `media_url()` (SET domain).
- **Acceptance criteria:**
  - Given a 6 MB PNG, When uploaded as the header sample, Then the form errors with the 5MB image message and no row is created.
  - Given Attachment=Location with latitude 95, When saved, Then the latitude error is returned and the form keeps its input.
  - Given Attachment=Image with an uploaded JPEG, When saved on a WABA channel, Then the JPEG is stored under `wa-templates/` and its Meta handle is uploaded during submit.
  - Given a WABA template whose stored image was deleted from storage, When re-submitted, Then the user sees the "missing from storage" error and no Meta call is made.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (store, update, collectTemplateLocation, validateCoordinates, resolveAttachmentType, assertMediaSize, materializeTemplateMedia, guessMime), `app/Services/Waba/TemplatePayloadBuilder.php` (buildHeader), `app/Services/Waba/TemplateLinter.php` (checkHeader), migrations `2026_06_12_000000_add_header_location_to_wa_templates.php`, `2026_07_16_000100_add_header_sample_url_to_wa_templates.php`.
- **Port notes:** store media in the platform object storage with signed URLs; keep the per-type caps in one constant shared with the send-time override uploader (`/api/upload-media`, MAX 5/16/100/16 MB). Fix the LOCATION lint contradiction.

### WD-TPL-010 — Buttons editor and button persistence

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-007
- **Summary:** Up to 3 buttons per standard template, authored as rows of (type, label, value): Visit website, Quick reply, Call phone, Copy code. Tabs "Call to action / Quick reply / Mix" only change the default type of the next added row.
- **Actors & access:** manager+.
- **UX & screens:** Buttons section (06): segmented tabs (`cta`, `reply`, `mix`), one seeded CTA row, "Add CTA button / Add quick reply / Add button" link (disabled at 3 rows), each row = type select + text input (maxlength 25) + value input (placeholder changes: `https://...`, `+15551234567`, `PROMO50`; hidden for quick reply) + remove icon. Switching the tab to "Quick reply" converts existing rows to quick replies and hides type/value; "CTA" converts quick replies back to Visit website. Hidden for catalog. In the edit form rows are pre-rendered from the stored buttons (only the four types are selectable; other stored types default visually to the first option).
- **Endpoints:** part of `POST templates` / `PUT templates/{id}`.
- **Data:** `wa_templates.buttons` (encrypted array). Element shape: `{type, text, value?, country_code? (call_phone), url_type? (visit_website), example?}`. Stored `type` values in the wild: `visit_website`, `quick_reply`, `call_phone`, `copy_code`, `catalog`, `otp_one_tap`, `otp_copy` (WABA), and uppercase `URL`, `QUICK_REPLY`, `PHONE_NUMBER` with `url`/`phone_number` (local DM and Meta-style rows).
- **Rules & edge cases:**
  1. Server `processButtons`: reads parallel arrays `button_type[]`, `button_text[]`, `button_value[]`, `country_code[]`, `url_type[]`; a row with empty text is skipped; `country_code` is kept for `call_phone`, `url_type` for `visit_website`; then every `quick_reply[]` string (trimmed, non-empty) is appended as a quick-reply button; the final list is cut to the first 3 (hard cap; matches the editor limit and the Node formatter).
  2. On create the button list is only computed if the request has `button_type` or `quick_reply`; on update the same condition applies, so a form submit that removes ALL rows sends neither field and the stored buttons stay unchanged (QUIRK: buttons cannot be cleared through the edit form).
  3. Alias table (`WaTemplate::buttonSubType`): `visit_website|url|cta_url` -> url; `copy_code|copy_text|coupon_code` -> copy_code; `call_phone|call|phone|phone_number|cta_call|voice_call|catalog` -> NONE (no send-time parameter, sending one is Meta #132000); anything else -> quick_reply.
  4. Linter (WABA only, see WD-TPL-023): at most 10 buttons, 2 URL, 1 phone, 1 copy code; same-type buttons must be consecutive; label required and <= 25 chars; URL required and <= 2000 chars; a URL containing a `{{placeholder}}` requires `variable_map.url_<index>[0]` as an example (the UI has no field for it, so dynamic URL buttons created in the UI always fail lint, QUIRK); phone must match `^\+?\d{6,15}$`.
  5. Meta mapping (WD-TPL-024): visit_website/url -> URL (+ example when placeholder), call_phone/phone_number -> PHONE_NUMBER, copy_code -> COPY_CODE (example defaults to the value or "ABC123"), quick_reply/default -> QUICK_REPLY; at most 10 emitted.
  6. Copy-code and call-phone buttons on non-WABA channels are sent by the Node formatter as text/buttons; the 3-button cap exists because WhatsApp reliably renders 3 interactive buttons.
  7. The UI never produces `catalog`, `otp_*` buttons for standard forms; editing an imported/catalog/OTP template re-renders these rows with the first select option (Visit website) and a save would overwrite them (QUIRK, data-corrupting).
- **Async & events:** none.
- **External systems:** Meta button component limits.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 4 button rows in a crafted request, When saved, Then only the first 3 are stored.
  - Given a quick-reply-only tab, When the row is added, Then the row has no value field and posts `button_type=quick_reply`.
  - Given a stored `copy_text` button, When a send payload is built, Then it is treated as `copy_code` and gets a coupon_code parameter.
  - Given a WABA template with URL, quick reply, URL order, When submitted, Then lint fails with the grouping rule message.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (processButtons), `app/Models/WaTemplate.php` (buttonSubType, buttonMeta), `app/Services/Waba/TemplateLinter.php` (checkButtons), `app/Services/Waba/TemplatePayloadBuilder.php` (buildButtons), `resources/js/charts/user-templates-create.js`, `resources/js/charts/user-templates-edit.js`.
- **Port notes:** model buttons as a discriminated union (`url | phone | copy_code | quick_reply | catalog | otp | flow`) with a shared validator used by the form and the linter; fix the "cannot clear buttons" gap by always posting the full list.

### WD-TPL-011 — Carousel templates

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-TPL-007
- **Summary:** A carousel template is an intro body above 2-10 swipeable cards, each with an image (or video), a card body and one button (UI) - Meta allows two.
- **Actors & access:** manager+. Plan flag `access_carousel_templates` exists but is not enforced (QUIRK, see Open questions).
- **UX & screens:** `?type=carousel`. Section "Intro message" (Header max 60, Footer max 60, Body required max 1024) and "Cards" (counter `n/10`, "Add card"). Each card: image tile (accepts `image/*`, hint "800x800 recommended"), Title (max 40), Body (max 160), button text (max 25) and button URL. The standard sections are disabled while carousel is active so they are not posted. Live preview renders a horizontally scrolling card row. Edit form renders the same section from stored `carousel_data` (format is fixed at create time).
- **Endpoints:** part of `POST templates` / `PUT templates/{id}`. Extra request fields: `carousel_titles[]`, `carousel_bodies[]`, `carousel_images[<idx>]` (files), `carousel_button_types[]` (hidden value `url`), `carousel_button_texts[]`, `carousel_button_values[]`, `carousel_button_card_indexes[]`, `carousel_body`.
- **Data:** `wa_templates.carousel_data` (encrypted array): `[{title, body, image (disk path), buttons:[{type,text,value}]}]`; images under `wa-templates/carousel/`; `template_type='carousel'`; top-level `header`, `template_body`, `footer` hold the intro message.
- **Rules & edge cases:**
  1. `processCarouselData` builds cards by iterating `carousel_titles`; body from `carousel_bodies[idx]`; image from `carousel_images[idx]` if it is a valid upload; buttons are those whose card index equals the card index. If titles, bodies and images are all empty the carousel payload is ignored (an empty carousel with the parent fields is still saved).
  2. Top-level body comes from `carousel_body` if present else `template_body`. No server-side cap on card count or per-card fields, no MIME/size validation on card images (the UI restricts to images; the validator has no rule for `carousel_images`).
  3. Update: if the request has no carousel arrays the stored cards are kept; when they exist, cards (and images) are REPLACED entirely; old card files are not deleted.
  4. Linter (WD-TPL-023): 2-10 cards; top-level body required; each card needs body (max 160), an image, 1-2 buttons; every card must use the same media format (by file extension mp4/mov/3gp = VIDEO else IMAGE) and the same button shape (types in the same order). The `title` is never sent to Meta.
  5. Submit uploads each card image to Meta and passes handles as `card_<idx>` keyed by the 0-based array index; a card whose file is missing is silently skipped, which produces a card without a HEADER and a Meta rejection.
  6. Send: `buildSend` emits a `carousel` component with `card_index` re-indexed 0..N-1; per-card header media is sent as a link (top-level media-id resolution of WD-TPL-035 does not apply to cards); card buttons are filtered with the same "does this button take a parameter" rule. Card body variables come from `variable_map.cards[idx].body`, which no UI writes, so card variables are effectively unsupported.
  7. Imported carousel templates come back with `image = null` on every card (WD-TPL-028), so they cannot be sent until images are re-attached (edit form allows upload).
  8. Docs claim media type can be image or video per template; the builder infers it from the extension only.
- **Async & events:** as WD-TPL-025.
- **External systems:** Meta carousel component (`CAROUSEL` with `cards[].components`).
- **Settings:** package flag `access_carousel_templates` (not enforced).
- **Acceptance criteria:**
  - Given 1 card, When a WABA carousel is submitted, Then lint errors "Carousel must have 2-10 cards (you have 1)".
  - Given card 1 has a URL button and card 2 has a quick reply, When submitted, Then lint reports the button-shape mismatch.
  - Given 3 valid cards with images, When submitted, Then three header handles are uploaded and the CAROUSEL component contains three cards with HEADER, BODY and BUTTONS.
  - Given an edit that posts no card fields, When saved, Then existing cards are unchanged.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (processCarouselData, store, update), `app/Services/Waba/TemplateLinter.php` (checkCarousel), `app/Services/Waba/TemplatePayloadBuilder.php` (buildCarouselComponents, buildSendCard), `app/Services/Waba/TemplateImporter.php` (parseCarousel), `resources/views/user/templates/create.blade.php`, `resources/js/charts/user-templates-create.js`.
- **Port notes:** normalize cards into a child table (`template_cards`) or a validated JSONB; add server-side limits (2-10 cards, image required, MIME/size) and enforce the plan flag. Store card media ids, and resolve Meta media ids at send time like the main header.

### WD-TPL-012 — Catalog templates (WABA only)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TPL-007
- **Summary:** A Meta "catalog template": a MARKETING body with a single "View catalog" button that opens the WABA-connected product catalog, with an optional thumbnail product.
- **Actors & access:** manager+, WABA channel only.
- **UX & screens:** `?type=catalog`. Header, Attachment and Buttons sections are hidden and disabled; a "Catalog button" section (07) shows "Button label" (max 25, default "View catalog") and "Thumbnail product" (a select of workspace catalog products, "Catalog cover (no specific product)" default, or a free text SKU/retailer id input when the workspace has no products). Amber banner "Connect a WhatsApp Business (Meta) number first" when no WABA channel exists.
- **Endpoints:** part of `POST templates`; request fields `catalog_button_text`, `thumbnail_product_retailer_id`.
- **Data:** `template_type='catalog'`, `meta_category='marketing'`, `channel='waba'`, `buttons=[{type:'catalog', text:<label max 25>, value:<retailer id or ''>}]`, `attachment_type='none'`, `attachment_file=null`. Product options come from `wa_products` (`meta_retailer_id` else `sku` else `wsn-<id>`).
- **Rules & edge cases:**
  1. Server forces channel WABA + category marketing regardless of the payload (defense in depth).
  2. Linter: category must be MARKETING; exactly one CATALOG button and no other button; no media/location header; a header text only produces a warning ("ignored by WhatsApp"); warns when the workspace has no `wa_catalogs` row for provider waba.
  3. Meta create payload: BODY (+ optional FOOTER) + BUTTONS `[{type: CATALOG, text}]` - no header, no thumbnail. Send-time: adds a button component `{sub_type: catalog, index: 0, parameters:[{type: action, action:{thumbnail_product_retailer_id}}]}` using a send-time override value or the retailer id stored on the button; omitted when blank.
  4. `buttonSubType('catalog')` is NULL so the generic per-button loop never emits it (avoids a bogus quick_reply and #132000).
  5. QUIRK: the edit form has no catalog section, so editing a catalog template shows standard sections and rewrites its buttons (WD-TPL-010 rule 7).
  6. Importing from Meta maps a CATALOG button to a generic quick reply (see WD-TPL-028), so imported catalog templates lose their type.
- **Async & events:** as WD-TPL-025.
- **External systems:** Meta catalog templates; requires a catalog connected to the WABA.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `?type=catalog` and no WABA connected, When the form loads, Then the amber warning is shown and submit is rejected server-side.
  - Given a catalog template with thumbnail `SKU-1`, When sent, Then the Meta payload includes the catalog button component with `thumbnail_product_retailer_id=SKU-1`.
  - Given a catalog template with category utility posted, When saved, Then it is stored as marketing.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (create catalogProducts, store isCatalog branch), `app/Services/Waba/TemplateLinter.php` (checkCatalog), `app/Services/Waba/TemplatePayloadBuilder.php` (buildCatalogComponents, buildSend), `resources/views/user/templates/create.blade.php`.
- **Port notes:** depends on the catalog domain (CAT) for products/`wa_catalogs`. Add proper catalog rendering on edit or disable editing of catalog templates.

### WD-TPL-013 — Authentication (OTP) templates and code expiry

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-007
- **Summary:** Meta authentication templates (one-time passcodes) are supported by the linter, payload builder and sender, and by import from Meta, but the web builder cannot author a valid one.
- **Actors & access:** manager+.
- **UX & screens:** In the create/edit form, choosing category "Authentication" shows a fixed WhatsApp verification-code preview ("<code> is your verification code. For your security, do not share this code.", footer "This code expires in 10 minutes.", a "Copy code" button) and reveals the "Code validity" section (number input 1-90, placeholder 10). The form still submits the normal body/buttons and `template_type=standard` (QUIRK). The docs page describes choosing type "Authentication" and adding a copy-code or one-tap OTP button with package name and signature hash - that UI does not exist (docs-only for the web builder).
- **Endpoints:** part of create/update; API v1 and mobile API accept `template_type=auth`.
- **Data:** `template_type='auth'`, `code_expiration_minutes` smallint unsigned null (1-90, default 10 at build time), `meta_category='authentication'`, buttons `otp_one_tap` (with `package_name`, `signature_hash`, `autofill_text`) or `otp_copy`.
- **Rules & edge cases:**
  1. Linter for `auth`: meta category must be AUTHENTICATION; exactly one OTP button (`otp_one_tap` or `otp_copy`); one-tap requires `package_name` and `signature_hash`.
  2. Meta create payload for auth: components `BODY {add_security_recommendation: true}`, `FOOTER {code_expiration_minutes: clamp(1..90), default 10}`, `BUTTONS [{type: OTP, otp_type: ONE_TAP|COPY_CODE, text default "Copy code", autofill_text default "Autofill", package_name, signature_hash}]`, plus `message_send_ttl_seconds: 60`.
  3. Import from Meta marks a template `auth` when the BODY has `add_security_recommendation`, the FOOTER has `code_expiration_minutes` (stored on the row) or a button is an OTP; OTP buttons map to `otp_one_tap`/`otp_copy`.
  4. Send: the OTP is generated per recipient by the caller (6-digit random, `str_pad`) and is NOT overridable (the mapping panel is locked with an explanation); `buildSend` forces `body=[code]` and a URL-type button param at index 0 with the same code; the daily-cap/quality gates apply except that RED quality does not auto-pause `auth` templates (WD-TPL-030).
  5. QUIRK: because the UI posts `template_type=standard`, a UI-created "Authentication" template is built as a normal template under the AUTHENTICATION category; Meta rejects it. API-created `auth` templates are stored `approved` locally with no OTP buttons and no Meta submission.
  6. Expiry is only display/one-tap autofill metadata on Meta; the customer's own backend validates codes.
- **Async & events:** none specific.
- **External systems:** Meta authentication template format.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an auth template with a one-tap button lacking `package_name`, When submitted, Then lint blocks with the one-tap error.
  - Given `code_expiration_minutes` blank, When the payload is built, Then FOOTER carries 10.
  - Given an imported OTP template, When listed, Then its type is `auth` and its expiry equals Meta's value.
  - Given an auth template send, When the recipient list has 3 contacts, Then each gets a different generated code used for both body and button.
- **Source refs:** `app/Services/Waba/TemplateLinter.php` (checkAuth), `app/Services/Waba/TemplatePayloadBuilder.php` (buildAuthComponents, buildSend), `app/Services/Waba/TemplateImporter.php` (parseComponents), `app/Http/Controllers/BroadcastsController.php` (varsForRecipient), `app/Models/WaTemplate.php` (sendMeta locked reason), `resources/views/user/templates/create.blade.php`, `resources/js/charts/user-templates-create.js`, `Documentation/pages/automation/templates.html`, migration `2026_07_31_000100_add_code_expiration_minutes_to_wa_templates.php`.
- **Port notes:** build a dedicated Authentication form (code length/expiry, copy-code vs one-tap, package name, signature hash) that sets `type=auth`; keep OTP generation in the send worker and never persist codes.

### WD-TPL-014 — Variable mapping panel and slash attribute picker

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-008
- **Summary:** While typing the body, `/` opens an attribute popover that inserts a named token; a "Variable mapping" panel lists each distinct token by slot and lets the operator pick which attribute fills it.
- **Actors & access:** manager+.
- **UX & screens:** `resources/js/attribute-picker.js` (CON asset, shared) and `resources/js/template-var-map.js`. The "Variable" pill in the body toolbar inserts a `/`. Panel rows: token pill, arrow, select "- not mapped -" plus every attribute as "<name> (<key>)". Empty hint "No variables yet. Add a placeholder like {{1}} above (or press / in the body) to map it to an attribute." The panel observes only the body textarea (not the header). The panel is visible on WhatsApp forms (a stale template comment claims it is hidden) and hidden for local-DM channels.
- **Endpoints:** consumes `GET /attributes/api/list` (CON) returning `{system:[{key,name,value?}], custom:[...]}`.
- **Data:** writes the hidden `variable_map_json` `{slot: attribute_key}`; slots use first-appearance numbering, the same order the server renumbers into.
- **Rules & edge cases:**
  1. A NAMED token pre-selects its own name as the attribute (`prev[slot] || token`); a numeric token keeps its prior mapping or stays unmapped; slots no longer present are dropped on re-render.
  2. Regex for tokens: `[a-zA-Z0-9_][\w.-]*` (allows dots and hyphens).
  3. Per WD-TPL-008 rule 4, for bodies containing named tokens the server ignores this JSON (only the legacy positional path reads it).
  4. Attribute list load failure yields an empty list (select still shows "not mapped").
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the body `Hi {{name}} and {{order_id}}`, When typed, Then two rows appear, each preselected to its own token name.
  - Given the user types `/` after a space, When the popover opens and "First name" is chosen, Then `{{first_name}}` is inserted.
  - Given the attributes endpoint fails, When the panel renders, Then rows still appear with only the "not mapped" option.
- **Source refs:** `resources/js/template-var-map.js`, `resources/js/attribute-picker.js`, `resources/views/user/templates/create.blade.php`, `resources/views/user/templates/edit.blade.php`.
- **Port notes:** the attribute catalog belongs to the contacts/attributes module; expose `GET /v1/attributes/catalog` and reuse it in the send-time panel (WD-TPL-039) via one shared hook.

### WD-TPL-015 — Live preview and client-side authoring guards

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-006
- **Summary:** The create/edit pages render a phone-frame live preview that formats WhatsApp markup, substitutes sample values for tokens, and blocks a submit that Meta would obviously reject.
- **Actors & access:** manager+.
- **UX & screens:** preview column (`.preview-col`): language pill, header, body, footer, time, attachment placeholder or the picked media (image/video/document via object URL), location bubble, button list, carousel scroller; authentication category swaps to the fixed OTP layout (WD-TPL-013). Local-DM channels use IG/Messenger/Telegram chrome. Character counters `n/1024`. Toolbar: Bold (`*`), Italic (`_`), Strike (`~`), Code (` ``` `) wrap the selection (default text "text").
- **Endpoints:** consumes `/attributes/api/list` (values for samples).
- **Data:** none persisted.
- **Rules & edge cases:**
  1. Sample substitution (`template-vars.js`): a token resolves to the real attribute value from the workspace, else a built-in stand-in (name/first_name John, last_name Doe, full_name John Doe, company Acme Co, email john@example.com, phone/mobile +1 555 0142, city Austin, country USA, order_id ORD-12, invoice INV-77, amount/total/price $49.00, discount 15%, coupon/promo/code SAVE15, otp 482913, date May 25, time 2:30 PM, tracking TRK-93421, product Hoodie, quantity 2, url/link example.com/x), else the literal `{{token}}`. Numeric tokens use the slot map if present. This is display only.
  2. Submit guard (WABA channel only, or when no channel selector exists): if the visible body STARTS with a variable, ENDS with a variable, or has two variables with nothing between them (`}}` whitespace `{{`), the submit is prevented with a toast/alert explaining the Meta rule and the body gets focus. The server linter treats start/end as warnings and adjacency as an error, so the client is stricter than the server on start/end.
  3. The edit page applies the same guard using the form's `data-channel` (non-WABA edits are unrestricted).
  4. Preview formatting regexes: `*bold*`, `_italic_`, `~strike~`, ` ```code``` `, `{{...}}` pill, newlines to `<br>`; text is HTML-escaped first.
  5. The header type select (Text/None) is cosmetic; posting relies on the header input value.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given WABA is selected and the body is `{{1}} your order is ready`, When the form is submitted, Then it is blocked with the "STARTS with a variable" message.
  - Given the channel is Unofficial API and the same body, When submitted, Then it is allowed.
  - Given the body `Hi {{name}}` and the workspace has no `name` value, When previewed, Then it renders "Hi John".
- **Source refs:** `resources/js/charts/user-templates-create.js`, `resources/js/charts/user-templates-edit.js`, `resources/js/template-vars.js`.
- **Port notes:** share the format/sample code with the library card and detail page; keep the client guard in sync with the server linter (WD-TPL-023) by generating client rules from the same rule table.

### WD-TPL-016 — Build with AI

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TPL-006
- **Summary:** A "Build with AI" modal on the create page drafts a template (name, header, body, footer, buttons or carousel cards) from a business brief using an admin-enabled or workspace-own AI key, and fills the form fields for review.
- **Actors & access:** manager+. Needs an active AI key (platform `admin_ai_keys`, or the workspace's own BYOK key). No plan gate in the code beyond BYOK resolution (AIADM domain).
- **UX & screens:** modal `#ai-modal`: AI model select (options `<provider>|<model>` loaded from the models endpoint, empty state "No AI providers are enabled. Ask an admin..."), Business name (required, max 120), Industry (12 options), Occasion (12), Purpose (8), Primary action (7), Tone (6), Language (read-only, from the page), Custom prompt (max 2000). "Generate Template" shows a spinner; success closes the modal, fills fields and toasts "Template draft filled from AI." Errors show inline (e.g. "Business name is required.", server message).
- **Endpoints:**
  | METHOD uri                     | route name                     | Controller@action                 | middleware                                | request fields                                                                                                                                                                                                                                                                                                          | response                                                                                     |
  | ------------------------------ | ------------------------------ | --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
  | GET templates/api/ai-models    | user.templates.api.ai-models   | TemplatesController@apiAiModels   | Authenticate, EnsureWorkspaceRole:manager | -                                                                                                                                                                                                                                                                                                                       | `{ok, models:[{value, label, provider}]}`                                                    |
  | POST templates/api/ai-generate | user.templates.api.ai-generate | TemplatesController@apiAiGenerate | same                                      | `model` (required, max 120), `provider` (required, in openai/anthropic/gemini), `type` (standard/carousel), `category` (marketing/utility/authentication), `language` (max 16), `business_name` (required, max 191), `industry`, `occasion`, `purpose` (max 120), `action`, `tone` (max 60), `custom_prompt` (max 2000) | `{ok, template:{template_name, header, body, footer, buttons[], cards[]?}, model}` or errors |
- **Data:** reads `admin_ai_keys` (active, not `elevenlabs`, ordered by `sort_order`; models = `default_model` + `extra_config.models`), `ai_provider_keys` (workspace BYOK).
- **Rules & edge cases:**
  1. Model list: each active admin key contributes its models labelled "<Provider> . <model>" (OpenAI, Anthropic, Google, Mistral); providers with an active workspace key REPLACE the admin models with fixed lists (openai: gpt-4o-mini, gpt-4o; anthropic: claude-sonnet-4-6, claude-haiku-4-5-20251001; gemini: gemini-2.0-flash, gemini-1.5-pro; mistral: mistral-large-latest, mistral-small-latest) labelled "(your key)". QUIRK: this list does not check the plan's BYOK entitlement while generation does (`AiKeyResolver::resolve`), and the picker can list Mistral while generation rejects any provider outside openai/anthropic/gemini with 422.
  2. Generation: if no key resolves -> 422 `{error:no_key, message:"Admin has not enabled this provider in /admin/api-keys."}`; the LLM is called with a strict-JSON system prompt (standard or carousel), `maxTokens=1600`, `temperature=0.6`; empty reply -> 502 `provider_failed`; non-JSON (after stripping ``` fences) -> 422 `bad_json` with the first 600 chars.
  3. Hard caps applied to the result: name 60 chars; header 60; body 1024; footer 60; at most 3 buttons of type visit_website/call_phone/copy_code (else forced to visit_website) with text 25 and value 2000; carousel: up to 10 cards {title 40, body 160, button_text 25, button_url 2000}.
  4. Prompt rules given to the model: Meta-policy compliant, no emojis, `{{1}}` `{{2}}` placeholders, 1-3 buttons, 3-5 cards for carousel.
  5. The client slugifies the name (`[a-z0-9_]`, max 60), fills header/body/footer, replaces button rows (max 3; unknown types become Visit website) or fills carousel cards, re-renders the preview and re-emits `input` on the body so the mapping panel updates. It never submits the form.
  6. The generated draft is unsaved; no usage row is written by this controller (token metering, if any, lives inside `AiAgentService::callProvider`, AIADM).
- **Async & events:** synchronous LLM HTTP call in the request.
- **External systems:** OpenAI, Anthropic, Google Gemini via `AiAgentService::callProvider`; key resolution via `AiKeyResolver`.
- **Settings:** `admin_ai_keys.extra_config.max_tokens` (platform output cap), plan `allow_byok_ai_keys`.
- **Acceptance criteria:**
  - Given no AI key is active, When the modal opens, Then the empty-state message shows and Generate is disabled.
  - Given a brief with business name and tone, When Generate succeeds, Then the form fields are filled and the name is a lowercase slug of at most 60 chars.
  - Given the model returns 5 buttons, When parsed, Then only 3 are kept.
  - Given the LLM returns prose instead of JSON, When parsed, Then the user sees "Model output was not valid JSON. Try again or refine the brief."
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (apiAiModels, apiAiGenerate, aiSystemPrompt*, buildAiUserPrompt), `app/Services/AiKeyResolver.php`, `app/Services/AiAgentService.php` (callProvider), `resources/js/charts/user-templates-create.js`, `resources/views/user/templates/create.blade.php`.
- **Port notes:** put the call behind the shared AI gateway module (provider adapter, per-workspace metering) and validate the JSON with a schema (zod) instead of regex-stripping fences.

### WD-TPL-017 — Template detail page and Meta review status

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-004
- **Summary:** `/templates/{id}` shows a template the way WhatsApp will render it plus its Meta sync facts, review banners (not submitted, in review, rejected, paused), lint warnings and refresh controls.
- **Actors & access:** manager+.
- **UX & screens:** `resources/views/user/templates/show.blade.php`, JS `user-templates-show.js`.
  - Left rail: info card (icon by channel, name, "<META CATEGORY> . <Type>", status pill, Quality pill only when Approved and not Instagram), "Meta sync" facts (Status, Quality, Meta category, Template ID, Submitted date, Last synced relative), WABA account card (verified name/label + phone) or an amber "No WABA account connected. Connect one" card, and a Related links block (Back, Edit, "Use in a broadcast" when approved). Instagram templates swap the Meta cards for an Instagram card (Type "Local DM template", Synced to <brand>, button count).
  - Header: breadcrumb, big name, "<CATEGORY> . <language> . <Type>", buttons "Refresh" (not for Instagram) and "Edit" (dimmed and non-clickable while in review, but the URL still works).
  - Banners: red "Meta submission failed" (from the `meta` error bag, preserves line breaks); amber "Not submitted to Meta yet" with a "Submit to Meta" form (and a WABA picker when more than one WABA is connected; a variant without the form when no WABA exists); sky "Submitted for Meta review" (with submit/last-check times and a "Refresh now" button); red "Rejected by Meta" with friendly text for the rejection code and "Edit & resubmit"; amber "Paused by Meta" with auto-unpause time; one amber row per flashed `lint_warnings` entry.
  - Preview card (WhatsApp-style bubble incl. header media - stored image, else Meta's sample URL `header_sample_url` - footer, buttons, carousel cards) and a "Components" breakdown (Header, Body, Footer, Buttons with type chip and value).
- **Endpoints:**
  | METHOD uri         | route name          | Controller@action        | middleware                                | request fields | response                                                                              |
  | ------------------ | ------------------- | ------------------------ | ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
  | GET templates/{id} | user.templates.show | TemplatesController@show | Authenticate, EnsureWorkspaceRole:manager | -              | HTML; vars `template`, `provider`, `wabaSubmittable`, `wabaConfigs`, `selectedWabaId` |
- **Data:** reads the template, its provider config (by `provider_config_id`, else the workspace primary), connected WABA configs.
- **Rules & edge cases:**
  1. Lookup: `forCurrentWorkspace()->find($id)` else `approved()->findOrFail($id)`. QUIRK/SECURITY: `approved()` has no workspace constraint; on a non-WABA workspace any approved/public template of ANOTHER tenant is readable by id (also in edit). The port must scope every read by tenant.
  2. `isPending` = Meta status PENDING, IN_APPEAL, PENDING_DELETION, or (empty Meta status AND local status pending). `isApproved`, `isRejected`, `isPaused` (Meta PAUSED OR `paused_until` in the future), `isDisabled` (DISABLED, LIMIT_EXCEEDED, FLAGGED, DELETED).
  3. `onMeta` = `meta_template_id` set. `notSubmitted` = not on Meta AND local status in (pending, draft) AND not approved/rejected: shows "Not submitted" pill and the recovery banner. The Submit button appears only when `waba_templates_v2_enabled` is on AND a provider exists (`wabaSubmittable`).
  4. Status labels: Approved, Rejected, In review, In appeal, Deleting, Deleted, Disabled, Limit exceeded, Flagged, Paused; default = capitalized meta/local status or "Draft".
  5. Friendly rejection copy: ABUSIVE_CONTENT (flagged as abusive or threatening), INVALID_FORMAT (format violates Meta's rules), PROMOTIONAL (marketing language not allowed in category), TAG_CONTENT_MISMATCH (category does not match content), SCAM (potential scam), NONE (nothing), otherwise the stored `rejection_reason` text.
  6. The polling script (WD-TPL-026) starts only when `data-tpl-meta-status` is PENDING and the tab is visible, and does a full reload on any terminal status.
  7. Lint warnings arrive through `session('lint_warnings')` flashed by submit/edit (one-shot).
- **Async & events:** 30-second polling (WD-TPL-026).
- **External systems:** none directly (Refresh calls WD-TPL-026).
- **Settings:** `waba_templates_v2_enabled`.
- **Acceptance criteria:**
  - Given a WABA template saved after a failed submit (no `meta_template_id`), When opened, Then the pill reads "Not submitted" and the "Submit to Meta" banner is shown.
  - Given a rejected template with code TAG_CONTENT_MISMATCH, When opened, Then the friendly copy and "Code: TAG_CONTENT_MISMATCH" are shown with an "Edit & resubmit" link.
  - Given `paused_until` in the future, When opened, Then the "Paused by Meta" banner shows the unpause time even if `meta_status` is APPROVED.
  - Given a template of another workspace, When requested by id, Then (port) it must return 404.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (show), `resources/views/user/templates/show.blade.php`, `resources/js/charts/user-templates-show.js`.
- **Port notes:** `apps/web/app/(app)/templates/[id]/page.tsx`; data from one `GET /v1/templates/:id` returning `effectiveStatus`, `onMeta`, `provider`, banners derived server-side.

### WD-TPL-018 — Edit template (PUT /templates/{id})

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-007
- **Summary:** Edits name, category, language, header, body, footer, attachment, buttons, carousel cards, code expiry and Twilio SID of an existing template. Format (standard vs carousel) is fixed at creation.
- **Actors & access:** manager+; workspace-scoped (own rows and admin globals).
- **UX & screens:** `resources/views/user/templates/edit.blade.php`, JS `user-templates-edit.js`. Header shows breadcrumb `Templates / Edit / tpl_0007`, a status badge (Approved, Rejected, else "Pending"), Delete and "Save changes". Same sections as create but no channel picker and no WABA account picker; the Twilio SID field shows only when the template's own channel is `twilio`. Named display: stored `{{1}}` tokens are rewritten to `{{ key }}` using the saved `variable_map` for display only. `data-channel` drives the client Meta guard. Success: redirect to the library with flash `Template "<name>" updated.` (variants in WD-TPL-019).
- **Endpoints:**
  | METHOD uri              | route name            | Controller@action          | middleware                                | request fields                                                                        | response       |
  | ----------------------- | --------------------- | -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- | -------------- |
  | GET templates/{id}/edit | user.templates.edit   | TemplatesController@edit   | Authenticate, EnsureWorkspaceRole:manager | -                                                                                     | HTML           |
  | PUT templates/{id}      | user.templates.update | TemplatesController@update | same                                      | same fields as create (all `sometimes`), plus `provider_config_id` for Meta re-target | 302 to library |
- **Data:** updates the row via `fill()->save()`.
- **Rules & edge cases:**
  1. `edit` lookup mirrors `show` (workspace scope else any approved template, same cross-tenant QUIRK); `update`/`destroy` use `forCurrentWorkspace()->findOrFail` (own rows AND admin-seeded globals can be edited/deleted by any workspace manager - QUIRK: a tenant can modify or delete the shared starter library for everyone).
  2. Validation is the create rule set with `sometimes` instead of `required`; the same normalization, placeholder validation, location handling (clears the pin when attachment type is not location), button parsing (only replaced when `button_type`/`quick_reply` are present), carousel replacement and file handling (WD-TPL-009..011) apply. Blank text inputs arrive as null and are dropped by the validator's null filter, so clearing header or footer text does not clear the stored value (QUIRK, to verify live).
  3. Category and `status` can be changed through the payload (`status` is validated but the form never sends it).
  4. Editing a `pending` WABA template is allowed locally but nothing is sent to Meta (WD-TPL-019). Editing a WABA template that never reached Meta only saves locally; the operator must click "Submit to Meta" on the detail page.
  5. Replacing the attachment does not delete the previous file from storage.
  6. Twilio: `twilio_content_sid` accepted only with the regex; not nulled on non-Twilio channels on update.
- **Async & events:** `LogsNotifications` "updated" record; optional Meta edit push.
- **External systems:** see WD-TPL-019.
- **Settings:** `waba_templates_v2_enabled`.
- **Acceptance criteria:**
  - Given an approved Baileys template, When the body is edited and saved, Then the library shows the flash and the new body; no Meta call occurs.
  - Given the edit form is submitted with the body `Hi {{name}}`, When saved, Then the body is stored as `Hi {{1}}` and the form later displays `Hi {{ name }}`.
  - Given a manager of workspace B, When they PUT a template of workspace A, Then 404 (port; WaDesk behaves so via `forCurrentWorkspace`).
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (edit, update), `resources/views/user/templates/edit.blade.php`, `resources/js/charts/user-templates-edit.js`.
- **Port notes:** treat globals as read-only (clone-to-edit) - there is no legitimate reason for a tenant to mutate shared rows. Use PATCH semantics with explicit `null` support so fields can be cleared.

### WD-TPL-019 — Push edits of a live template to Meta

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-018, WD-TPL-025
- **Summary:** When an already-submitted WABA template is edited, the change is also sent to Meta's edit endpoint so the approved copy does not keep sending old content; Meta re-reviews every edit.
- **Actors & access:** manager+; needs `waba_templates_v2_enabled`.
- **UX & screens:** result via flash on the library after save: success ("... updated. Changes submitted to Meta for re-review."), error ("Saved locally, but Meta rejected the edit: <reason>") or warning ("This template is still in review on Meta - edits can only be sent once it is approved or rejected. Your changes are saved here.").
- **Endpoints:** part of `PUT templates/{id}`.
- **Data:** on success sets `provider_config_id`, `meta_status=PENDING`, `status=pending`, `submitted_at=now`, `last_synced_at=now`.
- **Rules & edge cases:**
  1. Condition: `meta_template_id` set AND `channel = waba` AND `waba_templates_v2_enabled` on. If `meta_status = PENDING` -> skipped with the warning (Meta forbids edits during review); the local save stands.
  2. `editOnMeta` resolves the WABA (request `provider_config_id`, then the row's, then primary/first connected), lints (errors block: "Meta would reject the edit: - ..."; warnings flashed), uploads header/card media again (new handle each time), builds the payload and calls `TemplateClient::edit`, which POSTs to `/{meta_template_id}` with ONLY `category` and `components` (name and language are immutable on Meta).
  3. A successful edit flips the row to PENDING so the send gate stops treating it as approved until Meta re-approves; the sweeper/webhook later restores APPROVED.
  4. Local edits are NOT rolled back when Meta rejects the edit (local and Meta copies diverge until fixed).
  5. Edits of non-WABA channels never touch Meta.
- **Async & events:** synchronous HTTP; status changes later arrive via WD-TPL-029.
- **External systems:** Meta Graph `POST /{template_id}` (edit) plus media upload endpoints.
- **Settings:** `waba_templates_v2_enabled`, `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given an APPROVED WABA template, When the body is changed and saved, Then Meta receives an edit with new components and the row becomes `pending`/`PENDING`.
  - Given a PENDING template, When edited, Then no Meta call is made and the warning flash is shown.
  - Given the edit violates lint, When saved, Then the local row is updated, Meta is not called and the error flash starts "Saved locally, but Meta rejected the edit".
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (update, editOnMeta), `app/Services/Waba/TemplateClient.php` (edit).
- **Port notes:** model an explicit `edit_pending` state and keep the previous approved snapshot so a rejected edit can be reverted; run the push in a job.

### WD-TPL-020 — Delete template (local + Meta)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TPL-004
- **Summary:** Deleting a template removes the local row and, when it was pushed to Meta, also deletes it on Meta by name so the importer does not resurrect it.
- **Actors & access:** manager+; JSON endpoint used by the card trash icon (confirm dialog) and the edit page Delete button.
- **UX & screens:** confirm dialog "Delete template? Delete "<name>"? This can't be undone."; toasts "Template deleted" / "Delete failed: <msg>"; the grid is re-fetched.
- **Endpoints:**
  | METHOD uri            | route name             | Controller@action           | middleware                                | request fields | response                                |
  | --------------------- | ---------------------- | --------------------------- | ----------------------------------------- | -------------- | --------------------------------------- |
  | DELETE templates/{id} | user.templates.destroy | TemplatesController@destroy | Authenticate, EnsureWorkspaceRole:manager | -              | `{ok:true, data:{id, meta_deleted: true | false | null}, meta:{all, approved, pending, rejected}}` |
- **Data:** hard-deletes `wa_templates` row (no soft delete). `booking_templates.wa_template_id` is set NULL by FK; `broadcasts.template_id`, `wpcampaigns.template_id(_a/_b)`, `scheduled_messages.template_id`, keyword replies, flows, `invoice_settings.template_id_whatsapp` and message rows keep dangling ids (no FK).
- **Rules & edge cases:**
  1. Lookup with `forCurrentWorkspace()` (includes global starters, see WD-TPL-018 rule 1).
  2. If `meta_template_id` and a name exist: resolve the WABA (row's `provider_config_id`, else primary); when it is provider=waba call `DELETE /{waba_id}/message_templates?name=<name>` (Meta deletes by NAME, removing all languages of that name). Any failure is swallowed (`meta_deleted=false`) and the local delete proceeds.
  3. The response `meta` counts are computed with `statusCounts(WaTemplate::query()->get())` - an UNSCOPED query over all tenants' rows (QUIRK: counts leak/are wrong; the client ignores them and re-fetches).
  4. Stored media files are not removed on the web path (the mobile API removes the file and carousel images).
  5. In-flight campaigns/broadcasts/scheduled sends referencing the template are not blocked or warned.
- **Async & events:** `LogsNotifications` "deleted" record.
- **External systems:** Meta Graph `DELETE /{waba_id}/message_templates`.
- **Settings:** none beyond WABA credentials.
- **Acceptance criteria:**
  - Given a WABA template on Meta, When deleted, Then Meta receives a delete-by-name and the row disappears; if Meta errors the row still disappears.
  - Given a Baileys template, When deleted, Then no Meta call is made and the library count decreases.
  - Given a booking type using the template, When it is deleted, Then the booking template mapping keeps existing but with a NULL template.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (destroy), `app/Services/Waba/TemplateClient.php` (deleteByName), `resources/js/charts/user-templates-index.js`.
- **Port notes:** soft-delete (`deleted_at`) plus a "used by N campaigns/flows" pre-check; return a 409 with the usage list unless forced. Scope counts to the tenant.

### WD-TPL-021 — Manual approve / reject endpoints

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TPL-004
- **Summary:** Two JSON endpoints let a workspace manager flip a template's LOCAL status to approved or rejected. They exist for the Unofficial/Twilio workflow ("set the status yourself") but no screen calls them.
- **Actors & access:** manager+ (the code comment notes "any authenticated operator can flip - tighten once roles land"). The seeded permissions `templates.view/create/edit/delete` are NOT checked anywhere.
- **UX & screens:** none (docs mention "Approve / reject (your own)" but the UI has no control; treat as docs-only UI).
- **Endpoints:**
  | METHOD uri                  | route name             | Controller@action           | middleware                                | request fields                             | response                  |
  | --------------------------- | ---------------------- | --------------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------- |
  | POST templates/{id}/approve | user.templates.approve | TemplatesController@approve | Authenticate, EnsureWorkspaceRole:manager | -                                          | `{ok, data:{id, status}}` |
  | POST templates/{id}/reject  | user.templates.reject  | TemplatesController@reject  | same                                      | `rejection_reason` required string max 500 | `{ok, data:{id, status}}` |
- **Data:** approve sets `status=approved`, `approved_at=now`, `rejection_reason=null`; reject sets `status=rejected` and the reason. `meta_status` is untouched.
- **Rules & edge cases:**
  1. Workspace-scoped lookup (`forCurrentWorkspace`, includes globals).
  2. On a WABA workspace approving locally does not make the template sendable (send gates need `meta_status=APPROVED` and a `meta_template_id`).
  3. Not applied to WABA rows by the UI; a WABA row's effective status is Meta's.
- **Async & events:** notification "updated".
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a pending Baileys template, When POST approve is called, Then `status=approved` and the row becomes selectable in pickers.
  - Given reject without a reason, When called, Then 422 validation error.
  - Given a WABA template without `meta_template_id`, When approved locally, Then it still does not appear in WABA pickers.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (approve, reject), `database/seeders/RolePermissionSeeder.php`.
- **Port notes:** keep only if product wants manual moderation for local channels; otherwise drop (auto-approved local channels make it unnecessary). If kept, guard with the `templates.edit` permission.

### WD-TPL-022 — JSON helper endpoints for list, show and preview

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TPL-004
- **Summary:** Three small JSON endpoints support pickers and previews in other screens: an approved-template list for the flow builder, a single-template fetch for the campaign composer, and a server-side merge preview.
- **Actors & access:** manager+.
- **UX & screens:** consumed by `user-flows-builder.js` (`/templates/api/list?type=standard`) and `user-wa-campaigns-create.js` (`/templates/api/{id}`); `preview` has no caller.
- **Endpoints:**
  | METHOD uri                      | route name                 | Controller@action           | middleware                                | request fields             | response                                                                                                                                                                                 |
  | ------------------------------- | -------------------------- | --------------------------- | ----------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET templates/api/list          | user.templates.api.list    | TemplatesController@apiList | Authenticate, EnsureWorkspaceRole:manager | `type=standard` (optional) | `{ok, templates:[{id, template_name, template_type, category, meta_category, header, template_body, footer, buttons, carousel_data, attachment_type, attachment_file (URL), language}]}` |
  | GET templates/api/{id}          | user.templates.api.show    | TemplatesController@apiShow | same                                      | -                          | `{ok, template: <full model, decrypted>}`                                                                                                                                                |
  | POST templates/api/{id}/preview | user.templates.api.preview | TemplatesController@preview | same                                      | `vars` (object)            | `{ok, header, body, footer, buttons}`                                                                                                                                                    |
- **Data:** reads `wa_templates`.
- **Rules & edge cases:**
  1. `apiList` = `approved()` (engine-aware: WABA requires Meta approval + not paused) AND `forCurrentWorkspace()`, ordered by id desc, optionally only `template_type=standard`. Workspace-scoped (previously leaked all tenants).
  2. `apiShow` uses `forCurrentWorkspace()->findOrFail`, returns every column including `provider_config_id`, `twilio_content_sid`, `variable_map` (the whole model JSON).
  3. `preview` merges `{{name}}` and `{name}` (word chars) from `vars`; unknown tokens stay literal; it does NOT use positional maps or the override resolver.
  4. Route order: `/templates/api/list`, `/ai-models`, `/ai-generate` are declared before `/api/{id}` (numeric constraint) to avoid capture.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a WABA workspace, When `/templates/api/list` is called, Then only Meta-approved, unpaused templates of this workspace (and approved globals) are returned.
  - Given `type=standard`, When called, Then carousel/auth/catalog templates are excluded.
  - Given vars `{name:"Ana"}` and body `Hi {{name}} / {name}`, When previewed, Then both forms are replaced.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (apiList, apiShow, preview, mergeBody), `resources/js/charts/user-flows-builder.js`, `resources/js/charts/user-wa-campaigns-create.js`.
- **Port notes:** fold into `GET /v1/templates?sendable=true&type=` and `GET /v1/templates/:id`; drop the unused preview or reuse the shared variable renderer.

### WD-TPL-023 — Pre-submit linter

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** -
- **Summary:** `TemplateLinter` predicts Meta rejections before a submit or edit so failed submissions do not lower the WABA quality score. Errors block, warnings are flashed.
- **Actors & access:** internal, runs inside submit (WD-TPL-025) and Meta edit (WD-TPL-019). Only for WABA rows.
- **UX & screens:** errors appear as "Template would be rejected by Meta:" bullet list on the detail page (`meta` bag); warnings appear as amber rows (`lint_warnings` session flash).
- **Endpoints:** none.
- **Data:** reads the template row and, for catalog, `wa_catalogs`.
- **Rules & edge cases:** (E = error, W = warning)
  1. Name: E if empty; the slug (`[^a-z0-9_]+` to `_`, lowercased) must be non-empty/not just `_` and <= 512 chars.
  2. Language: E unless matches `^[a-z]{2,3}(_[A-Z]{2})?$` (en_US, hi_IN, en, pt_BR).
  3. Body: E if blank; E > 1024 chars; W > 800 chars; W for 3+ consecutive newlines; W for an ALL-CAPS word of 5+ letters; W for a MARKETING template with no placeholder; W if it starts with a placeholder; W if it ends with a placeholder; E for two adjacent placeholders (`{{1}}{{2}}` or separated only by whitespace); E for 4+ consecutive spaces; E for a tab; emoji count > 10 (ranges 1F300-1FAFF, 2600-27BF, 2B00-2BFF): E in MARKETING, W otherwise.
  4. Header: E if `attachment_type` set (not none) without a file; E if text > 60 chars; E if more than one placeholder.
  5. Footer: E > 60 chars; E if it contains a placeholder.
  6. Placeholders (header + body haystack, regex `[\w_]+`): in POSITIONAL format, E if any named token exists; E unless distinct numbers are 1..N contiguous; W when the number of real examples (`variable_map.body` entries flattened to a scalar) is lower than the distinct placeholder count ("Meta auto-rejects templates without per-placeholder examples"). In NAMED format, E for tokens not matching `^[a-z][a-z0-9_]*$`.
  7. Buttons: see WD-TPL-010 rule 4.
  8. Carousel (type carousel): E for card count outside 2..10, missing top-level body, missing/oversized (>160) card body, missing card media, mixed media formats, no buttons on a card, > 2 buttons on a card, differing button shape vs card 1.
  9. Auth (type auth): see WD-TPL-013; Catalog: see WD-TPL-012.
  10. Trigger phrases (W) over body+header+footer, case-insensitive substring: guaranteed, 100%, act now, click here, limited time only, winner, congratulations you have won, free money, claim now, risk free, no obligation, lifetime deal, don't miss.
  11. The setting `waba_template_lint_strict` (described as "warnings block submit") is stored by the admin form but never read by the linter (dead setting).
  12. Regex `\w` is ASCII-only here, so placeholders with non-Latin names are not detected.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `waba_template_lint_strict` (unused).
- **Acceptance criteria:**
  - Given a MARKETING body with 11 emojis, When linted, Then an error states the hard reject; given UTILITY, Then only a warning.
  - Given body `{{1}} {{2}}`, When linted, Then the consecutive-placeholder error appears.
  - Given placeholders {{1}} and {{3}}, When linted, Then the gap error lists `{{1}}, {{3}}`.
  - Given body containing "Click here", When linted, Then a trigger-phrase warning is returned but submission proceeds.
- **Source refs:** `app/Services/Waba/TemplateLinter.php`.
- **Port notes:** implement as a pure rules engine (`packages/contracts` or `apps/api/.../template-linter.ts`) with table-driven tests from the cases above; return structured issues `{code, severity, field, message}`; reuse in the web form for instant feedback.

### WD-TPL-024 — Meta create-payload builder

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TPL-023
- **Summary:** `TemplatePayloadBuilder::build` turns a local row into Meta's `POST /{waba}/message_templates` body: name, category, language, parameter format and typed components with examples.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** reads all template columns plus `variable_map` examples and media handles.
- **Rules & edge cases:**
  1. Envelope: `name` = normalized name; `category` = uppercase `meta_category`, else guessed (auth -> AUTHENTICATION; local vertical ecommerce/festival/travel -> MARKETING; otherwise UTILITY); `language` default `en_US`; `allow_category_change: true`; `parameter_format` default POSITIONAL; auth adds `message_send_ttl_seconds: 60`.
  2. Name normalization: lowercase, every run of non `[a-z0-9]` becomes `_`, trimmed of `_`, max 512, fallback `untitled_template`.
  3. Components by type: `auth` -> WD-TPL-013; `carousel` -> BODY + CAROUSEL; `catalog` -> WD-TPL-012; default standard/media -> optional HEADER, BODY, optional FOOTER, optional BUTTONS (max 10).
  4. HEADER: format from `attachment_type` (TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION; else TEXT). TEXT with a placeholder adds `example.header_text` (from `variable_map.header` entries coerced to strings, else placeholder names, else "Sample"). Media adds `example.header_handle: [<handle>]` (empty string if no handle).
  5. BODY: `text` plus `example.body_text = [[v1, v2, ...]]` (single set) only when placeholders exist; each example is the `variable_map.body[i]` coerced to a scalar (`example|text|value|key` field, else first scalar), falling back to the placeholder NAME, else "Sample N" (the literal word "example" is avoided because Meta auto-rejects it). QUIRK: because stored map entries are `{num,key}`, the Meta example becomes the attribute key (for example `first_name`), not a real sample value.
  6. Buttons mapped per WD-TPL-010 rule 5; URL buttons with placeholders add `example` (user example, else placeholder names, else `sample`).
  7. Carousel cards: HEADER (format inferred from extension, example handle only if a handle exists - an empty handle triggers Meta code 100), BODY (+ example from `variable_map.cards[idx].body`), BUTTONS; wrapped in `CAROUSEL.cards[]`.
  8. `countPlaceholders` counts each occurrence of `{{ word }}` (not distinct).
  9. Component `type` values are uppercase; auth button keys stay lowercase per Meta docs.
- **Async & events:** none.
- **External systems:** Meta template create schema.
- **Settings:** none.
- **Acceptance criteria:**
  - Given template name `Spring Promo v3!`, When built, Then Meta name is `spring_promo_v3`.
  - Given body `Hi {{1}}` with map `[{1,first_name}]`, When built, Then `example.body_text = [["first_name"]]`.
  - Given a media header with a handle, When built, Then HEADER has `format`, `example.header_handle[0]`.
  - Given category unset and type auth, When built, Then category is AUTHENTICATION.
- **Source refs:** `app/Services/Waba/TemplatePayloadBuilder.php` (build, buildComponents, buildStandardComponents, buildCarouselComponents, buildAuthComponents, buildCatalogComponents, buildHeader, buildBody, bodyExample, buildButtons, normalizeName, guessMetaCategory).
- **Port notes:** pure function with golden-file tests. Improve examples: use real sample values captured on the template instead of attribute keys.

### WD-TPL-025 — Submit to Meta (initial and retry) with media upload

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TPL-023, WD-TPL-024
- **Summary:** For WABA templates the create pipeline (and a "Submit to Meta" button on the detail page) lints the row, uploads header/card media to Meta, POSTs the template, and stores Meta's id, status and category. A failed submit leaves a recoverable local row.
- **Actors & access:** manager+; requires platform flag `waba_templates_v2_enabled` and a connected WABA config in the workspace.
- **UX & screens:** result is shown on the detail page: error bag `meta` ("Template would be rejected by Meta:" + bullets, or the Meta hint), flash "Template "<name>" submitted to Meta for review." (resubmit) or "... submitted for review." (create). The detail page banner (WD-TPL-017) offers the retry with an optional WABA picker.
- **Endpoints:**
  | METHOD uri                 | route name            | Controller@action                      | middleware                                | request fields                  | response                             |
  | -------------------------- | --------------------- | -------------------------------------- | ----------------------------------------- | ------------------------------- | ------------------------------------ |
  | POST templates/{id}/submit | user.templates.submit | TemplatesController@submitToMetaAction | Authenticate, EnsureWorkspaceRole:manager | `provider_config_id` (optional) | 302 back with status or `meta` error |
- **Data:** on success writes `provider_config_id`, `meta_template_id`, `meta_status` (Meta's status, default PENDING), `meta_category` (Meta's category if returned, else kept), `submitted_at`, `last_synced_at`, `status='pending'`.
- **Rules & edge cases:**
  1. Resubmit guards: flag off -> error "WABA template submission is turned off. Ask your admin to enable it in settings."; row already has `meta_template_id` -> info "This template is already on Meta (ID ...). Use Refresh to re-check its status." (no-op).
  2. WABA resolution (`resolveTemplateConfig`): (1) `provider_config_id` on this request, (2) the row's remembered config, (3) the workspace primary if it is a WABA, else the first connected WABA (order: primary, newest). Each candidate must be a CONNECTED provider=waba config in the row's own workspace. None -> "No WABA connected for this workspace. Connect a WABA account (or pick one) first."
  3. Lint: errors abort with the bullet list; warnings are flashed (`lint_warnings`).
  4. Media: if a media header file exists it is materialized (local disk path or streamed temp file), its MIME guessed from the extension (jpg/jpeg, png, gif, mp4, mov, pdf; else by header type) and uploaded through the resumable API; for carousels every card image is uploaded (cards without files are skipped). Handles are passed to the builder as `header` and `card_<idx>`. All temp files are deleted in a `finally`.
  5. `TemplateClient` construction requires `access_token` and `waba_id` in the config credentials (encrypted); a missing `waba_id` is recovered through `WabaIdBackfiller` (WABA domain) and stored; missing values raise "WABA config is missing <access_token|waba_id>. Reconnect the WhatsApp Business number under Devices so it's recaptured." and log a diagnostic breakdown (token length, decrypt status, expiry).
  6. Media upload needs the Meta App ID: config `app_id`, else `debug_token` lookup (cached back onto the config), else platform `waba_app_id`; otherwise an admin-oriented hint ("Set the Meta App ID in Admin > Settings > WhatsApp ...").
  7. QUIRK guard: if Meta answers 2xx without an `id`, the submit is treated as a failure ("Meta accepted the request but returned no template ID...") and the row stays unsubmitted so retry works.
  8. HTTP: 30 s timeout for Graph calls, 60 s for the binary upload; Graph base `https://graph.facebook.com/<waba_graph_api_version>`; auth `Bearer` token except upload (`OAuth <token>`).
  9. Error translation (`errorHint`): code 190 -> "Meta token expired or invalid. Reconnect this WABA, then retry."; 200/1349174 -> missing `whatsapp_business_management` permission; 100 -> "Bad parameter: <msg>"; 132000 -> parameter mismatch; 132001 -> language not supported; 132005 -> template not found; 132007 -> name already exists for a different language; 192 with limit-like text -> "Template exceeds your WABA's template quota. Delete old templates first."; default "Meta error <code>/<sub>: <msg>"; Meta's `error_user_msg` / `error_data.details` is appended, the numeric code is always kept, and a vague carousel code-100 gets an extra hint about re-uploading card images on the owning WABA.
  10. Every non-2xx is logged at warning level with the raw error (grep tag `[WABA-TEMPLATE]`).
  11. Multi-WABA correctness: the media handle is only valid on the WABA/app that minted it, hence the single resolved config for both steps.
- **Async & events:** synchronous; status updates arrive later (WD-TPL-026/027/029). `WebhookService` is not fired here.
- **External systems:** Meta Graph: `POST /{app_id}/uploads` (session), `POST /{session_id}` (bytes), `POST /{waba_id}/message_templates`, `GET /debug_token`.
- **Settings:** `waba_templates_v2_enabled`, `waba_graph_api_version` (regex `^v\d{1,2}\.\d{1,2}$`, default v23.0), `waba_app_id`; credentials in `wa_provider_configs.credentials_json` (encrypted) and `meta_json`.
- **Acceptance criteria:**
  - Given a valid WABA template and a connected WABA, When submitted, Then the row gets `meta_template_id`, `meta_status=PENDING`, `status=pending`, `submitted_at` and the user sees the success flash.
  - Given Meta returns code 190, When submitted, Then the banner reads the token-expired hint and the row remains without `meta_template_id`.
  - Given two connected WABAs and the picker set to the second, When submitted, Then media upload and create both use the second WABA and `provider_config_id` is stored.
  - Given the flag is off, When "Submit to Meta" is clicked, Then the disabled message is shown and nothing is called.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (submitToMetaAction, resolveTemplateConfig, submitToMeta, materializeTemplateMedia, guessMime), `app/Services/Waba/TemplateClient.php`, `app/Services/Waba/TemplatePayloadBuilder.php`, `app/Services/Waba/TemplateLinter.php`, `app/Services/Waba/WabaIdBackfiller.php`.
- **Port notes:** create a `MetaTemplateClient` provider adapter in the WABA module; run as a BullMQ job `template.submit` with retry policy for transient 5xx only; persist `submit_error` for UI. Secrets from the encrypted credentials vault. Idempotency key = template id.

### WD-TPL-026 — Per-template status refresh and detail-page polling

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TPL-025
- **Summary:** The detail page polls `POST /templates/{id}/refresh` every 30 seconds while the template is PENDING (and the tab is visible), and offers a manual "Refresh" button. The endpoint fetches Meta's state for one template.
- **Actors & access:** manager+.
- **UX & screens:** `user-templates-show.js`: polling stops on any terminal status (APPROVED, REJECTED, PAUSED, DISABLED, LIMIT_EXCEEDED, FLAGGED, DELETED) and reloads the page; the manual button spins and toasts: "Status refreshed from Meta.", "Already up to date - try again in a few seconds." (rate limited), "This template hasn't been sent to Meta yet - submit it first, then its review status will appear here.", "Couldn't reach the server - please try again.", "Refresh failed - check your connection.", "Already refreshing...". Background polls are silent.
- **Endpoints:**
  | METHOD uri                  | route name             | Controller@action           | middleware                                | request fields | response                                                                                                                                                                              |
  | --------------------------- | ---------------------- | --------------------------- | ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST templates/{id}/refresh | user.templates.refresh | TemplatesController@refresh | Authenticate, EnsureWorkspaceRole:manager | -              | `{ok:false, reason:'not_submitted', meta_status}` or `{ok:true, rate_limited:true, meta_status, last_synced}` or `{ok:true, meta_status, quality_score, last_synced, rejection_code}` |
- **Data:** updates `meta_status`, `meta_category`, `quality_score`, `rejection_reason_code`, `last_synced_at`, local `status`, `approved_at`, `paused_until` (via the sweeper's state application, WD-TPL-027 rule 4).
- **Rules & edge cases:**
  1. Stuck-row relink: if the row is a WABA-channel template with no `meta_template_id`, and the lock `waba_tpl_relink:<id>` (15 s) can be acquired, the full workspace import runs first (WD-TPL-028) so a name+language match links the row; then the row is reloaded.
  2. If still no `meta_template_id` or no `provider_config_id` -> `not_submitted`.
  3. Rate limit: cache lock `waba_tpl_refresh:<id>` for 15 s; a locked call returns the current stored values with `rate_limited: true` (protects the Meta GET quota).
  4. Otherwise `TemplateSyncSweeper::one()` does `GET /{meta_template_id}?fields=id,name,status,category,language,quality_score,rejection_reason,components`; on error it only bumps `last_synced_at`.
  5. Poll cadence 30 s; timer is stopped when the tab is hidden and a fetch happens immediately when it becomes visible again (only while `data-tpl-meta-status` = PENDING).
- **Async & events:** none server-side; client polling.
- **External systems:** Meta Graph `GET /{template_id}`.
- **Settings:** none (15 s and 30 s constants).
- **Acceptance criteria:**
  - Given a PENDING template, When Meta flips it to APPROVED, Then the next poll updates the pill and reloads the page to show approved actions.
  - Given two rapid manual refreshes, When the second arrives within 15 s, Then it returns `rate_limited` without calling Meta.
  - Given a draft never submitted, When Refresh is clicked, Then the "hasn't been sent to Meta yet" toast appears.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (refresh), `app/Services/Waba/TemplateSyncSweeper.php` (one), `app/Services/Waba/TemplateClient.php` (fetch), `resources/js/charts/user-templates-show.js`.
- **Port notes:** replace polling with a server-sent event or a short poll + the webhook (WD-TPL-029) as the primary source; keep per-template rate limiting in Redis.

### WD-TPL-027 — Stale-status sweep and opportunistic import on library load

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-026
- **Summary:** Because Meta webhooks can be silently dropped and WaDesk deliberately does not require a cron, the library page fires a fire-and-forget `POST /templates/sync-stale` on load and on tab foreground. It sweeps stale PENDING templates and (at most hourly) imports templates that exist on Meta but not locally.
- **Actors & access:** manager+; no-op unless `waba_templates_v2_enabled`.
- **UX & screens:** invisible; if `changed > 0` the grid refreshes silently.
- **Endpoints:**
  | METHOD uri                | route name                | Controller@action             | middleware                                | request fields | response                                                                           |
  | ------------------------- | ------------------------- | ----------------------------- | ----------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
  | POST templates/sync-stale | user.templates.sync-stale | TemplatesController@syncStale | Authenticate, EnsureWorkspaceRole:manager | -              | `{ok:true, enabled:false, changed:0}` when the flag is off; `{ok:true, changed:n}` |
- **Data:** updates stale rows like WD-TPL-026; import may create rows.
- **Rules & edge cases:**
  1. `TemplateSyncSweeper::forWorkspace`: cache lock `waba_tpl_sweep:ws:<id>` for 10 minutes (else returns 0); selects `staleSweepTargets` (WD-TPL-004 rule 6) for the workspace, LIMIT 25; groups by `provider_config_id` (one client per WABA); each fetch failure only bumps `last_synced_at`.
  2. Opportunistic import: lock `waba_tpl_import:ws:<id>` for 1 hour; runs `TemplateImporter::forWorkspace` and adds the number of newly imported rows to `changed`; import errors are logged at info level and swallowed.
  3. The manual "Sync from Meta" clears the import lock (WD-TPL-028).
  4. `applyMetaStateToRow`: `meta_status` = Meta status (uppercased); `meta_category` = Meta's category as returned (uppercase, unlike the importer's lowercase - QUIRK: mixed casing in `meta_category`; the library category filter compares lowercase and the linter uppercases, so refreshed rows can drop out of category tabs); `quality_score` normalized (string or `{score}` object); `rejection_reason_code` = Meta's `rejection_reason`; local `status` via the mapping in WD-TPL-004 rule 3; `approved_at` set once on first APPROVED; RED quality on a non-auth template sets `paused_until = now+1 day`.
  5. `waba_template_polling_min` (admin setting, 5-240, default 30) is stored but the sweeper uses fixed constants (10-minute debounce, 1 h/30 min staleness), so the admin setting is dead.
- **Async & events:** none (inline in the request).
- **External systems:** Meta Graph `GET /{template_id}`, `GET /{waba_id}/message_templates`.
- **Settings:** `waba_templates_v2_enabled`; dead: `waba_template_polling_min`.
- **Acceptance criteria:**
  - Given a template PENDING for 2 hours never synced, When the library loads, Then it is refreshed and the grid reloads if its status changed.
  - Given the sweep ran 3 minutes ago, When the library loads again, Then no Meta calls are made for sweeping.
  - Given a WABA connected an hour ago with templates on Meta, When the library first loads, Then those templates are imported without clicking "Sync from Meta".
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (syncStale), `app/Services/Waba/TemplateSyncSweeper.php`, `app/Models/WaTemplate.php` (scopeStaleSweepTargets), `resources/js/charts/user-templates-index.js` (wireStatusSweep), `app/Http/Controllers/AdminPagesController.php` (settings save).
- **Port notes:** implement as a scheduled BullMQ repeatable job per WABA (every N minutes, honoring the admin interval) plus the webhook; drop the page-load trigger. Normalize `meta_category` to one casing.

### WD-TPL-028 — Sync from Meta (template importer)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TPL-025
- **Summary:** "Sync from Meta" pulls every template from all connected WhatsApp Business accounts of the workspace into the local library, creating rows for templates made in Meta Business Manager and updating rows we already know. It is idempotent.
- **Actors & access:** manager+; button visible when the workspace has any provider=waba config. The importer itself does not check `waba_templates_v2_enabled` for the manual action.
- **UX & screens:** button "Sync from Meta" (tooltip "Fetch your approved templates from Meta") posts a form; result banner "Synced N template(s) from Meta - X new, Y updated." or "No templates found on this WhatsApp Business account yet."; failure banner "Sync from Meta failed: <reason>".
- **Endpoints:**
  | METHOD uri                      | route name                      | Controller@action                  | middleware                                | request fields | response                                |
  | ------------------------------- | ------------------------------- | ---------------------------------- | ----------------------------------------- | -------------- | --------------------------------------- |
  | POST templates/import-from-meta | user.templates.import-from-meta | TemplatesController@importFromMeta | Authenticate, EnsureWorkspaceRole:manager | -              | 302 to library with status/`meta` error |
- **Data:** upserts `wa_templates`.
- **Rules & edge cases:**
  1. Loops EVERY provider=waba config of the workspace; one failing account (missing token/waba id, missing permission) is skipped and logged; if none succeed the error names each account ("<phone or label>: <reason>", bullet list when several); otherwise totals of the good accounts are returned.
  2. Duplicate-connection guard: because `meta_template_id` is globally unique, if the same `waba_id` is connected by an EARLIER-created config in another workspace, the import for the later one fails with a clear message ("already connected in another workspace... disconnect it from the other workspace first"). The first-connected workspace owns the account's templates.
  3. Paging: `GET /{waba_id}/message_templates?fields=id,name,status,category,language,quality_score,rejection_reason,parameter_format,components&limit=200` following `paging.cursors.after` while `paging.next` exists, hard cap 50 pages.
  4. Match order for each Meta template: (a) row with the same `meta_template_id` in this workspace; (b) an un-linked WABA row in this workspace with the same name (case-insensitive) and language (exact, else base language, e.g. `en` matches `en_US`) - links it, fixing "approved on Meta but pending here"; (c) any row anywhere with that `meta_template_id` (an orphan from a removed workspace/config) - adopted into this workspace; a unique-key race (SQL 1062) also adopts the row.
  5. Written fields: workspace, `provider_config_id`, `channel=waba`, `meta_template_id`, `meta_status` (uppercase), `meta_category` (lowercased), `quality_score` (default UNKNOWN), `template_name`, `language`, `parameter_format` (default POSITIONAL), `template_type` (auth/carousel/standard from components), parsed `header`/`template_body`/`footer`/`buttons`/`carousel_data`/`attachment_type`, `header_sample_url` (only if Meta sent one), `variable_map`, local `status` (APPROVED -> approved, REJECTED -> rejected, others pending), `last_synced_at`; on REJECTED sets `rejection_reason_code`; new rows also get `category='utility'`, `user_id`=current user, `submitted_at`, and `approved_at` if approved; existing rows get `approved_at` only if APPROVED and empty.
  6. Component parsing (inverse of the builder): HEADER text -> `header`; IMAGE/VIDEO/DOCUMENT/LOCATION -> `attachment_type` lowercase and `example.header_handle[0]` -> `header_sample_url`; BODY -> body (auth flag if `add_security_recommendation`); FOOTER -> footer (+ `code_expiration_minutes`, marks auth); BUTTONS: URL -> `visit_website` with `value`=url, PHONE_NUMBER -> `call_phone`, COPY_CODE -> `copy_code` (value = first example), OTP -> `otp_one_tap|otp_copy`, QUICK_REPLY -> `quick_reply`, any other (FLOW, CATALOG, MPM, VOICE_CALL...) -> a generic `quick_reply` with the label (QUIRK: catalog/flow buttons lose their type); CAROUSEL -> type carousel, cards `{title:'', body, image:null, buttons}`.
  7. `variable_map` is rebuilt from the placeholders (`{num, key}` with key = token text, so `{{1}}` -> key "1") and merged with the stored one: the FRESH structure decides which slots exist but a stored non-numeric key (real attribute) is preserved so operator mappings survive every sync; numeric keys are unmapped defaults.
  8. Imported rows do not check `template_limit`, but count against it afterwards.
  9. A successful manual sync clears the hourly import lock.
  10. `rejection_reason` from Meta is stored only as the code (`rejection_reason_code`); the local `rejection_reason` text stays empty.
- **Async & events:** synchronous; logs `[WABA-template-import]`.
- **External systems:** Meta Graph `GET /{waba_id}/message_templates`.
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given 8 approved templates on Meta and an empty library, When "Sync from Meta" is clicked, Then 8 rows are created with `channel=waba`, `status=approved`, `meta_status=APPROVED` and the banner says "Synced 8 template(s) from Meta - 8 new, 0 updated."
  - Given a local pending row `promo` (en) not linked, When Meta reports `promo` (en_US) APPROVED, Then that row is linked and becomes approved instead of creating a duplicate.
  - Given the same WABA was first connected in workspace A, When workspace B syncs, Then it receives the "already connected in another workspace" error.
  - Given an operator mapped `{{1}}` to `first_name`, When the sync runs again, Then the mapping is preserved.
- **Source refs:** `app/Services/Waba/TemplateImporter.php`, `app/Http/Controllers/TemplatesController.php` (importFromMeta), `app/Services/Waba/TemplateClient.php` (list), `app/Services/Waba/TemplateSyncSweeper.php` (normalizeQualityScore).
- **Port notes:** BullMQ job `template.import` per WABA account with pagination; unique index on `(waba_account_id, meta_template_id)`; make the "one workspace per WABA" rule explicit in the WABA connection flow. Import card media by downloading Meta's sample handles.

### WD-TPL-029 — Template lifecycle webhooks (status, quality, category, components)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-025
- **Summary:** Meta pushes four template-related webhook fields to the WhatsApp inbound webhook; WaDesk mirrors each into the matching `wa_templates` row so status, quality, category and pause windows are current without polling.
- **Actors & access:** Meta (signed webhook handled by the WABA domain: `GET|POST webhooks/whatsapp/inbound`); no user action.
- **UX & screens:** effects visible in the library and detail page.
- **Endpoints:** handled inside `WaWebhookController@receive` (route owned by WABA): `applyTemplateUpdate(field, value, config)` for `changes[].field` in `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `message_template_components_update`. These fields are handled before any message/status processing.
- **Data:** updates `wa_templates`.
- **Rules & edge cases:**
  1. Match: `provider_config_id` = the receiving WABA config AND `meta_template_id` = `message_template_id`; fallback by decrypted name (`message_template_name`, case-insensitive) + language (exact or base language) among that config's templates. This scoping prevents a spoofed WABA id from touching another workspace's rows. No match -> info log `[WA-template-webhook] no matching template`, ignored.
  2. If the row lacked a `meta_template_id` and the payload has one, it is backfilled.
  3. Every applied event sets `last_synced_at`.
  4. `message_template_status_update`: `meta_status = event` (uppercase: APPROVED, REJECTED, PENDING, DISABLED, PAUSED, IN_APPEAL, LIMIT_EXCEEDED, FLAGGED, PENDING_DELETION, DELETED); `rejection_reason_code = reason` (uppercase, "NONE" if empty) for REJECTED else NULL; PAUSED sets `paused_until = now+24h` (conservative default); local `status` follows WD-TPL-004 rule 3; first APPROVED sets `approved_at`.
  5. `message_template_quality_update`: `quality_score` from `new_quality_score` (or `quality_score`), string or nested object; UNKNOWN is ignored (keeps the old score); RED on a non-auth template sets `paused_until = now+24h`.
  6. `template_category_update`: `meta_category = new_category` (UPPERCASE, e.g. MARKETING - QUIRK vs lowercase elsewhere).
  7. `message_template_components_update`: logged only; the local copy is not overwritten.
  8. No user notification, outbound webhook or audit event is emitted by this handler beyond the model's `updated` notification (WD-TPL-050).
- **Async & events:** inbound webhook only.
- **External systems:** Meta WhatsApp Business webhooks.
- **Settings:** none here (webhook verify token in WABA domain).
- **Acceptance criteria:**
  - Given a pending template with `meta_template_id=123`, When Meta sends status APPROVED for 123, Then `meta_status=APPROVED`, `status=approved`, `approved_at` set.
  - Given REJECTED with reason `INVALID_FORMAT`, When applied, Then `rejection_reason_code=INVALID_FORMAT`.
  - Given a webhook for a template id not belonging to the receiving WABA config, When received, Then nothing changes.
  - Given quality RED on a marketing template, When applied, Then `paused_until` is 24 hours ahead and sends are refused.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (applyTemplateUpdate ~L1046, dispatch ~L386), `app/Services/Waba/TemplateSyncSweeper.php` (normalizeQualityScore).
- **Port notes:** implement in the WABA webhook module as an idempotent handler (dedupe on Meta event id + timestamp); emit `template.status_changed` to the outbox so notifications/analytics can subscribe; add a dead-letter for unmatched events.

### WD-TPL-030 — Quality score, auto-pause and RED gate

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TPL-029
- **Summary:** Ban-prevention rails: a RED quality score auto-pauses non-authentication templates for 24 hours and hard-blocks sending; a PAUSED status also pauses for 24 hours; the pause window is re-checked by the sweeper.
- **Actors & access:** internal; effects visible on the detail page ("Paused by Meta" banner) and as failed sends.
- **UX & screens:** detail page pill "Quality . GREEN/YELLOW/RED/UNKNOWN" (only when Approved) and "Auto-unpause after <time>" text.
- **Endpoints:** none.
- **Data:** `quality_score`, `paused_until`.
- **Rules & edge cases:**
  1. `isMetaApproved()` requires `meta_status=APPROVED` and `paused_until` not in the future; `approved()` scope on WABA workspaces additionally excludes rows with a future `paused_until`.
  2. Only RED blocks sends; UNKNOWN (brand-new approved templates) and YELLOW are allowed. `qualityMeetsFloor()` (a rank table) exists in the sender but is unused.
  3. `paused_until` is set to now+1 day by the webhook (PAUSED status or RED quality) and by the sweeper (RED); nothing clears it except expiry (a future PAUSED-to-APPROVED event does not reset `paused_until`, but the gate compares the timestamp so it expires by time).
  4. Authentication templates are exempt from the RED auto-pause (still blocked at send if RED).
- **Async & events:** see WD-TPL-027/029.
- **External systems:** Meta quality webhooks.
- **Settings:** none.
- **Acceptance criteria:**
  - Given quality YELLOW, When a send is attempted, Then it proceeds.
  - Given quality RED, When a send is attempted, Then it fails with code `quality_floor`.
  - Given `paused_until` tomorrow, When the template list for pickers is built on WABA, Then the template is excluded.
- **Source refs:** `app/Models/WaTemplate.php` (isMetaApproved, isQualityHealthy, scopeApproved), `app/Services/Waba/TemplateSender.php`, `app/Services/Waba/TemplateSyncSweeper.php`.
- **Port notes:** derive a single `sendability` object `{sendable, reason}` from status+quality+pause and expose it on the API so UI and workers agree.

### WD-TPL-031 — Twilio Content SID templates

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TPL-007
- **Summary:** A template on the Twilio channel is just a pointer: the operator pastes the Twilio Content SID (`HX` + 32 hex) and the message content stays in Twilio's Content Template Builder. At send time the dispatcher switches from plain `Body` to `ContentSid` + `ContentVariables`.
- **Actors & access:** manager+; only when Twilio is an enabled engine of the workspace.
- **UX & screens:** Twilio radio + SID input (WD-TPL-006); the builder and preview are hidden; edit shows the SID field only for Twilio rows. Send-time panel: body variables are editable, media and button links are locked ("Twilio sends this template by Content SID ... Variable values can still be edited below.").
- **Endpoints:** part of create/update.
- **Data:** `wa_templates.twilio_content_sid` varchar(64) (indexed, plaintext), `channel='twilio'`, body set to the placeholder text "Twilio template (content managed in Twilio Content Builder)." when empty.
- **Rules & edge cases:**
  1. SID validation: regex `^HX[0-9a-fA-F]{32}$`, max 34 (Twilio error 21655 otherwise).
  2. Non-Twilio channels null out the SID on create; on update they do not (QUIRK).
  3. Send: `WhatsAppDispatcher` and `InboxDispatcher` look up `twilio_content_sid` by `template_id` on the outbound message and, if present, send `ContentSid` and `ContentVariables` (built from the message's positional variables) instead of `Body`/`MediaUrl`. Plain-text sends of marketing/utility/auth categories outside the 24 h window risk Twilio suspension, which is why the SID path exists.
  4. `engineKey()` falls back to `twilio` for rows without `channel` but with a SID.
  5. Status: auto-approved locally (no Meta involvement); Twilio itself owns approval.
- **Async & events:** none.
- **External systems:** Twilio Messages API (`ContentSid`, `ContentVariables`, `StatusCallback` `/api/twilio/status`).
- **Settings:** Twilio credentials in WABA/WADEV domains.
- **Acceptance criteria:**
  - Given an SID with 31 hex chars, When saved, Then a validation error is returned.
  - Given a Twilio template selected in a broadcast, When sent, Then the Twilio request carries `ContentSid` and JSON `ContentVariables`.
  - Given a Twilio template in the send-time panel, When opened, Then media and buttons are read-only and variables editable.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (store, validateTemplate), `app/Models/WaTemplate.php` (sendMeta), `app/Services/WhatsAppDispatcher.php` (~L1248), `app/Services/InboxDispatcher.php` (~L2078), `database/migrations/2026_05_27_140000_add_twilio_content_sid_to_wa_templates.php`.
- **Port notes:** the send side belongs to the Twilio provider adapter; here store and validate only. Add an optional "verify SID exists" call against Twilio Content API.

### WD-TPL-032 — Instagram templates with Instaflow sync and push

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TPL-007
- **Summary:** Instagram DM templates are local rows (channel `instagram`, always approved). In "remote Instaflow" mode they are mirrored both ways with an external Instaflow install: pushed on create, pulled by a "Sync from <brand>" button.
- **Actors & access:** manager+; sync button only when `instagram_enabled` is OFF (remote mode) and the workspace has an Instagram account linked; creation when an IG account is linked.
- **UX & screens:** channel step of the modal (WD-TPL-005) leads to the create form with the local-DM layout; library button "Sync from <ig brand>" with an Instagram gradient; flash "N Instagram template(s) synced from <brand>." / "No Instagram templates found on <brand>." / errors "Connect an Instagram account first." / "Instagram is not connected."
- **Endpoints:**
  | METHOD uri                    | route name                    | Controller@action                     | middleware                                | request fields | response                       |
  | ----------------------------- | ----------------------------- | ------------------------------------- | ----------------------------------------- | -------------- | ------------------------------ |
  | POST templates/sync-instaflow | user.templates.sync-instaflow | TemplatesController@syncFromInstaflow | Authenticate, EnsureWorkspaceRole:manager | -              | 302 to `/templates` with flash |
- **Data:** upserts `wa_templates` keyed by `(workspace_id, channel='instagram', template_name)`.
- **Rules & edge cases:**
  1. Pull: for each distinct `instaflow_account_id` linked to the workspace, list templates (`InstaflowClient::templates`); skip blank or duplicate names (case-insensitive across accounts); type `quick_replies` -> QUICK_REPLY buttons (label max 25); type `buttons` -> URL buttons (with url) or QUICK_REPLY when no url; type `text` -> no buttons; stored with `template_type=standard`, `category=meta_category=utility`, `language=en`, `status=approved`, `user_id` = current user. Upsert failures are logged and skipped. Note the upsert matches by the ENCRYPTED `template_name` column, which cannot match reliably (encrypted values differ per write), so re-syncs may create duplicates (to verify live).
  2. Push (best-effort, on create only): converts buttons to Instaflow shape - no buttons `text`; all QUICK_REPLY `quick_replies [{title,payload}]`; any non-quick-reply button `buttons [{type: web_url|postback, title, value}]` - and calls `InstaflowClient::pushTemplate` for every linked account; failures are logged as `[IG-TPL-PUSH]` and never block the local save. Edits and deletes are not pushed.
  3. Local (native addon) mode: templates are only authored locally; no sync button.
  4. Detail page shows the Instagram card instead of Meta fields and hides Refresh.
  5. Demo data: `InstagramTemplateShowcaseSeeder` seeds "IG ..." templates covering text, quick replies, CTA, mix and image header (env `FLOW_SEED_EMAIL`/`FLOW_SEED_WS_ID`).
- **Async & events:** synchronous HTTP to Instaflow.
- **External systems:** Instaflow API (`InstaflowClient::fromSettings()`), platform-configured.
- **Settings:** `instagram_enabled`, Instaflow connection settings (channel-instagram domain).
- **Acceptance criteria:**
  - Given remote mode with two Instaflow templates, When "Sync" is clicked, Then two approved Instagram rows appear and the flash says "2 Instagram templates synced from <brand>."
  - Given a new Instagram template with one URL button, When saved, Then Instaflow receives type `buttons` with a `web_url` item.
  - Given Instaflow rejects the push, When saved, Then the local template still exists.
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (syncFromInstaflow, pushInstagramTemplateToInstaflow), `database/seeders/InstagramTemplateShowcaseSeeder.php`, `resources/views/user/templates/index.blade.php`, `resources/views/user/templates/show.blade.php`.
- **Port notes:** the Instaflow bridge only matters for customers who run the external Instaflow product; treat as optional integration owned by the Instagram channel module. In the native Instagram module store `channel=instagram` templates and skip sync entirely.

### WD-TPL-033 — Template send gates and single send (TemplateSender send)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TPL-004, WD-TPL-030
- **Summary:** `TemplateSender` is the single entry point for sending an approved WABA template to one recipient. It enforces ban-prevention gates, resolves the sender number, prepares media, posts to Graph and returns a structured result. Every WABA template caller (campaigns, broadcasts, scheduled, inbox/chat, API v1, flows, auto-replies, e-commerce notifiers) goes through it.
- **Actors & access:** internal service; callers enforce their own roles.
- **UX & screens:** failures surface as per-recipient error text in the calling feature (e.g. campaign logs, inbox bubble errors, API 422).
- **Endpoints:** none of its own (see WD-TPL-042 for the public single-send API).
- **Data:** reads the template; reads `wa_provider_configs` (credentials, `meta_json.phone_number_id`); counters in cache; no DB writes except a language self-heal (`language`).
- **Rules & edge cases:** gates run in this order and short-circuit, returning `{ok:false, code, error, template_id}`:
  1. `not_approved`: `meta_status != APPROVED` ("Template is not approved by Meta (current: X). Wait for approval before sending.").
  2. `paused`: `paused_until` in the future ("Template is paused until <ISO>...").
  3. `quality_floor`: quality RED only ("...RED - sending would accelerate the quality drop and risk losing the WABA. Refusing.").
  4. `rate_limited`: only if the system setting `waba_template_daily_cap` > 0 (default 0 = off) and the counter `waba_tpl_cap:<id>:<Y-m-d>` >= cap; message says it resets at midnight UTC, but the key uses the app timezone date (QUIRK). The setting has no admin UI (only settable directly). The counter is incremented after each successful send (24 h TTL); the doc-comment default "tier / 4" is not implemented.
  5. `no_provider`: config = passed config, else the template's `provider_config_id`, else the workspace primary; must be provider=waba with `access_token` and `phone_number_id` (config `meta_json.phone_number_id` or credentials).
  6. Click tracking: button parameters of sub_type `url` whose value is a full valid URL are wrapped by `LinkTracker::wrap` with context {workspace, template, phone, plus `_tracking` extras (broadcast id, contact id, message id)}; `_tracking` is always stripped from vars first (never sent to Meta). Tracking is skipped when `waba_link_tracking_enabled` is false (default true). Placeholder-inside-URL templates are tracked at create time by the builder (not implemented in the builder shown).
  7. LOCATION header: the template's stored `header_location` is injected when the caller did not pass one.
  8. Media header rules (WD-TPL-035); `missing_header_media` failure when nothing can be resolved.
  9. Payload: `messaging_product=whatsapp`, `to` digits only, `type=template`, `template` = `buildSend` (WD-TPL-034); POST `{graph}/{phone_id}/messages` with Bearer token, 20 s timeout. Every send logs the exact payload (`[WABA-template-send]`).
  10. Error 132001 (template not found in that language): if the sent language has a region (`en_US`), retry ONCE with the base code (`en`); on success the row's `language` is corrected permanently (self-heal).
  11. Other Meta errors: `meta_error` with `MetaError::describe` (user message + code + trace) rather than a paraphrase.
  12. On success: returns `{ok, code:'ok', wamid, template_id}`, increments the cap counter, and fires the outbound platform webhook `message_sent` (`WebhookService::dispatch`) with {workspace_id, template_id, template_name, recipient, wamid, status:'sent', timestamp, quality_at_send}. Delivery/read/failed webhooks fire later from the inbound WhatsApp webhook handler.
  13. The sender writes NO Message/InboxMessage/Conversation rows; callers persist and mirror the send themselves.
  14. Timezone-independent; numbers are normalized only by stripping non-digits (E.164 validation is the caller's job).
- **Async & events:** HTTP call is synchronous in the caller's process (queue/worker in the port). Outbound webhook `message_sent`. Status webhooks come back through WABA.
- **External systems:** Meta Graph `POST /{phone_number_id}/messages`; `POST /{phone_number_id}/media` (WD-TPL-035).
- **Settings:** `waba_graph_api_version`, `waba_template_daily_cap`, `waba_link_tracking_enabled`.
- **Acceptance criteria:**
  - Given a template with `meta_status=PENDING`, When a send is attempted, Then it returns `not_approved` and no HTTP call is made.
  - Given a template whose language `en_US` yields Meta 132001, When retried with `en` succeeds, Then the row's language becomes `en`.
  - Given `waba_template_daily_cap=100` and 100 sends today, When the 101st is attempted, Then it returns `rate_limited`.
  - Given a URL button value `https://shop.test/x`, When sent with tracking enabled, Then the parameter is replaced by a tracked short link containing the recipient context.
- **Source refs:** `app/Services/Waba/TemplateSender.php` (send, wrapTrackableButtonValues, capKey, errorHint, fail), `app/Services/Waba/LinkTracker.php`, `app/Services/Waba/MetaError.php`, `app/Services/WebhookService.php`.
- **Port notes:** implement as `TemplateSendService` in the WABA outbound worker; gates as pure functions; persist the cap counter in Redis with an explicit UTC day; store the send attempt (wamid, error code) in `messages`. Enforce per-number throughput (Meta ~80 msg/s) in the queue rate limiter, not in the sender.

### WD-TPL-034 — Send-time payload construction (buildSend)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TPL-033
- **Summary:** `TemplatePayloadBuilder::buildSend` converts a template + resolved per-recipient variables into Meta's `template` object with exactly the parameters the approved template expects, avoiding the #132000/#131008 rejections that drag down quality.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** input `$vars` shape: `{ header (text), header_media_id, header_media_url, header_filename, header_location{latitude,longitude,name,address}, body:[...], buttons:[{index, sub_type, value}], cards:{i:{header_media_id|header_media_url, header_format, body:[...], buttons:[...]}}, otp, thumbnail_product_retailer_id }`.
- **Rules & edge cases:**
  1. Envelope: `name` = normalized name, `language.code` = row language (default `en_US`), `components`.
  2. Auth: code = `vars.otp` or `body[0]`; forces `body=[code]` and `buttons=[{index:0, sub_type:'url', value:code}]`.
  3. Header (text): the template's `attachment_type` names the MEDIA kind, so `none`/empty means a text header. Emit a header component only if the template header contains placeholders; then exactly as many text parameters as placeholders (usually 1); a blank value is back-filled with, in order: the template's own header example (non-numeric), the placeholder name (if a word), else `-`. NAMED templates tag the parameter with `parameter_name`. This fixes the historical #132000 "localizable_params (0) does not match (1)" bug.
  4. Header (media): image/video/document parameter using `id` if present else `link`; if the caller gave neither and the template has a stored file, that file's public URL is used; DOCUMENT always carries a `filename` (caller value, else URL basename unless it looks like our random upload name, else `<template name>.<ext>`; sanitized to `[\w .()-]`, ensures an extension, max 240 chars) because WhatsApp shows "Untitled" otherwise. Header (location): `location` parameter with lat/lng/name/address strings; skipped if lat/lng empty.
  5. Body: parameter count is forced to EXACTLY the number of placeholder occurrences in `template_body` (pad short lists, cut long lists; zero placeholders = no body component; auth = exactly one). Blank values are back-filled with the body example for that index, else the placeholder name (non-numeric), else `-` (Meta rejects empty text with #131008). Values are coerced to strings (arrays flattened by `example|text|value|key` or joined). NAMED format: each parameter carries `parameter_name`, and duplicates of the same name are dropped.
  6. Buttons: only buttons whose approved definition takes a parameter get one: quick_reply, copy_code, voice_call always; url only if the template URL has a placeholder or the button is an OTP; phone number never. Parameter shapes: quick_reply -> `{type:payload,payload}`, url -> `{type:text,text}`, copy_code -> `{type:coupon_code,coupon_code}`, catalog -> `{type:action,action:{thumbnail_product_retailer_id}}`; `index` is sent as an integer.
  7. Catalog templates: adds the catalog button component (retailer id from vars or the stored CATALOG button) when non-empty.
  8. Carousel: cards re-indexed 0..N-1; each card gets optional header media (id else link, format image/video), optional body params (strings), and its buttons filtered against the card's template button definitions.
  9. `countPlaceholders` counts occurrences of `{{ word }}` with `\w` (ASCII), so a token such as `{{Phone Number}}` inside a WABA template would not be counted (WABA templates are normalized to positional so this is only reachable for imported NAMED templates).
- **Async & events:** none.
- **External systems:** Meta Cloud API message template format.
- **Settings:** none.
- **Acceptance criteria:**
  - Given body `Hi {{1}}, order {{2}}` and vars body `["Ana"]`, When built, Then two body parameters are sent (`Ana` and the example/name/`-` fallback).
  - Given a template with no placeholders and stray vars `["x"]`, When built, Then no body component is emitted.
  - Given a static URL button, When vars include a value for it, Then no parameter is emitted.
  - Given a DOCUMENT header with no filename, When built, Then `filename` = `<template name>.pdf`.
- **Source refs:** `app/Services/Waba/TemplatePayloadBuilder.php` (buildSend, shouldEmitButtonParam, buildSendHeader, documentFilename, buildSendButton, buildSendCard, scalarize).
- **Port notes:** port as a pure function with golden tests for each Meta error scenario listed above; keep fallbacks (example, name, `-`).

### WD-TPL-035 — Header media resolution and upload at send time

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-033
- **Summary:** For IMAGE/VIDEO/DOCUMENT header templates the sender guarantees a Meta media id: it downloads the media (operator override, uploaded sample, or Meta's approved sample captured at import), normalizes it and uploads it to the sending phone number's media endpoint, caching the id.
- **Actors & access:** internal.
- **UX & screens:** failure reads "This template has a <TYPE> header but no <type> could be resolved. Re-sync the template from Meta (so we capture its sample image), or upload a header <type> on the template - then send again."
- **Endpoints:** none.
- **Data:** cache key `waba_tpl_hdr_media:v3:<template id|ovr>:<phone_id>:<md5(source url)>` (TTL 20 days; Meta media ids live about 30).
- **Rules & edge cases:**
  1. Source priority: send-time override URL (`header_media_url` in vars) > template `attachment_file` (public URL) > `header_sample_url`. A caller-supplied `header_media_id` short-circuits everything.
  2. Override path: uploaded and cached under its own key (`ovr`) so one send's swap cannot poison another; on upload failure the override falls back to sending the URL as `link`.
  3. Download uses a browser User-Agent (Meta's CDN returns an error page to header-less requests), follows redirects, 30 s timeout; a `text/*` content type means an error page and aborts.
  4. If the bytes are a multipart envelope (some authoring tools upload a form body to the resumable endpoint, which Meta stores verbatim), it is unwrapped by picking the largest part that decodes as an image.
  5. MIME: trust the download header; if empty/octet-stream infer from `attachment_type` (image/jpeg, video/mp4, application/pdf).
  6. Images (when GD is available) are decoded, downscaled to at most 1600 px on the long side, flattened onto white (removes alpha), and re-encoded as baseline JPEG quality 90, because Meta later fails validation (131053 "Image is invalid") on 16-bit/palette/CMYK renditions; memory_limit is temporarily raised (up to 512M) based on pixel dimensions to avoid OOM and restored after. If decode fails the original bytes are uploaded.
  7. Upload: `POST https://graph.facebook.com/<v>/<phone_id>/media` multipart with `messaging_product=whatsapp`, field `file`, name `header_<tpl>.<ext>`, 60 s. Success returns the id.
  8. Only VALIDATED (successfully decoded image or non-image) uploads are cached; an unvalidated id is used once but never stored, so a bad rendition cannot poison the cache for 20 days. The key is versioned (`v3`) to retire previously poisoned ids without flushing.
  9. Diagnostic logs tagged `tplSend:*` exist in code and should not be ported.
  10. Carousel card media is NOT resolved here (cards use link/id as given by the caller).
- **Async & events:** synchronous; cached.
- **External systems:** Meta media endpoint; the media source URL (own storage or Meta CDN).
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given an imported IMAGE-header template with `header_sample_url` and no file, When sent, Then the sample is downloaded, re-encoded to JPEG, uploaded once and the id reused for the next 20 days.
  - Given the sample URL returns HTML, When sent, Then the send fails with the "no image could be resolved" message.
  - Given an override URL, When sent, Then a separate cached id is used and other sends are unaffected.
- **Source refs:** `app/Services/Waba/TemplateSender.php` (send steps 6c, resolveHeaderMediaId).
- **Port notes:** move to a media-normalization worker (sharp/ffmpeg) with content-addressed caching in Redis; keep the "cache only validated" rule.

### WD-TPL-036 — Parallel batch send (sendMany)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-033
- **Summary:** Bulk WABA sends fire a chunk of recipients concurrently to reach Meta's throughput (~80 msg/s per number) instead of sequential 5-10 msg/s.
- **Actors & access:** internal (campaigns/broadcasts).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** input recipients `[{id, to, vars}]`; output map keyed by recipient id with the same result shape as `send`.
- **Rules & edge cases:**
  1. Template-level gates (approved, paused, RED quality, provider/creds) run ONCE for the batch; a gate failure gives every recipient the same failure.
  2. Concurrency = chunk size, clamped to 1..30, default 15 (about 50 msg/s, under Meta's 80/s; error 130429 is the throughput limit).
  3. Per recipient: same pipeline as `send` (tracking wrap, location injection, media resolution, missing-media check, buildSend); a payload-build exception fails only that recipient ("payload build failed: ...").
  4. Concurrent POSTs via `Http::pool`, then each response interpreted; 132001 base-language retry runs sequentially for failed items and self-heals the language.
  5. QUIRK: the daily cap is NOT checked in batch mode (only the counter is incremented per success), so `waba_template_daily_cap` is effectively enforced for single sends only.
  6. `message_sent` webhook is fired per success (best-effort, exceptions swallowed).
- **Async & events:** outbound `message_sent` per recipient.
- **External systems:** Meta Graph messages endpoint.
- **Settings:** as WD-TPL-033.
- **Acceptance criteria:**
  - Given 100 recipients and concurrency 15, When sent, Then requests go out in 7 waves and each recipient has an individual result.
  - Given the template is not approved, When sendMany runs, Then no HTTP call is made and all 100 fail with `not_approved`.
  - Given one recipient's media cannot be resolved, When sent, Then only that recipient fails.
- **Source refs:** `app/Services/Waba/TemplateSender.php` (sendMany, buildRecipientPayload, interpretResponse).
- **Port notes:** in the port, model as BullMQ jobs with a per-WABA-number rate limiter instead of `Http::pool`; still enforce the cap uniformly.

### WD-TPL-037 — Per-recipient variable resolution

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TPL-008
- **Summary:** For each recipient the platform turns the template's `variable_map` and buttons into the concrete parameter values sent to Meta. This logic (`BroadcastsController::varsForRecipient` + `TemplateOverrideResolver::lookup`) is shared by broadcasts, campaigns, scheduled sends, Team Inbox, chat, the extension and the mobile quick-message API.
- **Actors & access:** internal; caller supplies a recipient row.
- **UX & screens:** none (results visible in messages).
- **Endpoints:** none.
- **Data:** recipient row keys: `name, first_name, last_name, middle_name, title, phone, mobile, country_code, email, address, language, contact_group` plus `custom_attributes` (array); workspace `attributes` rows (`attribute_key`, `attribute_value`).
- **Rules & edge cases:**
  1. Auth templates: return `{otp: <random 6-digit>, body:[otp]}` only; per-recipient fresh code; NOT overridable.
  2. `flattenMap` accepts nested `{header:[{num,key}], body:[...]}` and flat `{"1":"first_name"}` shapes; `num` is trusted, else position+1.
  3. Value pull `$pull(key)`: (a) recipient field exactly named `key` if non-empty; (b) `custom_attributes[key]` exact if non-empty; (c) `lookup(key)`.
  4. `lookup(key)` tries the name as written, then the canonical form (`normalizeKey`: lowercase, spaces/hyphens/dots to `_`, strip non `[a-z0-9_]`, trim `_`, then alias). For each candidate in order: recipient column; `custom_attributes` compared by canonical key (case-insensitive); workspace static attribute with matching canonical key (non-empty); system tokens: `today` (current date `Y-m-d`), `business_name` (sender's WhatsApp verified/display name), `company_name` (business name, else platform brand name). Unresolved -> empty string (never the raw braces).
  5. Business name: among the workspace's WABA configs, connected ones first: `display_label`, else `meta_json.verified_name`; else the workspace name.
  6. Aliases (canonical): `phone_number, phone_no, whatsapp_number, number, contact_number` -> phone; `mobile_number, mobile_no` -> mobile; `full_name, customer_name, contact_name` -> name; `first` -> first_name; `last, surname` -> last_name; `mail, email_address, e_mail` -> email; `sender_name, sender, business, brand, brand_name, whatsapp_name, store_name, shop_name` -> business_name; `company_name` and `city` map to themselves.
  7. Values are scalarized (nested custom values joined with ", ") to avoid "Array to string conversion".
  8. Header: uses only the FIRST header-map entry (Meta allows one variable). Body: one value per map entry in order (list). Missing map -> no `body` key (the sender pads with fallbacks).
  9. Buttons (from the template's own `buttons`): sub_type via `buttonSubType` (NULL skipped: phone/catalog); value = the button's `value` with every `{{token}}` replaced (`TOKEN_RE` `\{\{\s*([^{}]+?)\s*\}\}` - accepts spaces and capitals); numeric tokens are translated through the body map (`flattenMap(...,['body'])[slot]`) then pulled; quick-reply buttons with an empty resolved value are skipped so Meta uses the label as payload; entries `{index, sub_type, value}`.
  10. Header media: if the template has a stored attachment (type not none/TEXT) `header_media_url = media_url(file)`.
  11. Carousel: per card `header_media_url` (stored image URL or as-is if `http*`), `header_format` (video if extension mp4 else image), `body` via `variable_map.cards[idx].body` (never populated by the UI), and buttons resolved like top-level with card-map translation.
  12. Finally the per-send overrides are overlaid (WD-TPL-038).
  13. Workspace-level token substitution for the Node/Baileys path is a different mechanism (`AttributeResolver::resolve`, WD-TPL-040): positional `{{N}}` via variable_map to workspace attribute values then named `{{key}}`; contact-level values there override workspace ones for non-empty fields.
  14. `TOKEN_RE` deliberately accepts any non-brace text so `{{Phone Number}}` and `{{Last Name}}` are counted, offered for editing, and resolved (previously they shipped raw to customers).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given map body `[first_name, city]` and a contact without `city` but with custom attribute `City`, When resolved, Then the second value uses the custom attribute case-insensitively.
  - Given a token `{{Phone Number}}`, When resolved, Then it returns the contact's phone via alias.
  - Given an unknown token, When resolved, Then the value is an empty string (later back-filled by the sender), never `{{token}}`.
  - Given an auth template and 3 recipients, When resolved, Then each gets a distinct code.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (varsForRecipient ~L1751), `app/Services/TemplateOverrideResolver.php` (flattenMap, normalizeKey, lookup, businessName, scalarize), `app/Services/AttributeResolver.php`, `app/Models/WaTemplate.php` (buttonSubType).
- **Port notes:** `packages/template-engine` with `resolveVars(template, recipient, workspaceAttrs, overrides)`; unit-test the alias table and precedence. Keep it independent of any controller.

### WD-TPL-038 — Send-time overrides with resolver, sanitizer and storage

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-TPL-037
- **Summary:** A send can shadow the template's variable mapping for that send only (text per slot, header media swap, button values) without editing the template. Overrides are stored on the sending row and applied per recipient.
- **Actors & access:** whoever composes a send (manager+ on campaigns/broadcasts/scheduled/chat; agents in Team Inbox through the composer; extension and mobile app).
- **UX & screens:** the panel of WD-TPL-039.
- **Endpoints:** field `template_overrides` (JSON string or array) accepted by the campaign, broadcast, scheduled, chat, team-inbox and extension send endpoints (owned by those domains); `template_overrides_b` for A/B campaigns.
- **Data:** longText encrypted-array columns `wpcampaigns.template_overrides`, `wpcampaigns.template_overrides_b` (A/B variant B), `broadcasts.template_overrides`, `scheduled_messages.template_overrides` (migrations `2026_07_18_000100`, `2026_07_20_140000`). Shape: `{header:{mode:'text'|'media', text|media_url}, body:[string...], footer:[string...], buttons:[{index, sub_type:'url'|'quick_reply'|'copy_code', value}]}`; values are TOKEN STRINGS (literal, `{{attribute}}`, or a mix).
- **Rules & edge cases:**
  1. `sanitize()` (run before persisting; returns NULL when nothing usable): header text trimmed and cut to 1024 (blank dropped); header media must be a valid `http(s)` URL (HTTPS is required by Meta but enforced at the WABA send layer, so LAN/http installs can still save for Baileys); body/footer arrays are trimmed, each cut to 1024 and only kept if at least one slot is non-blank; buttons keep only entries with an `index` and non-blank value, sub_type coerced into {url, quick_reply, copy_code} (default url), value cut to 2048. Unknown shapes are dropped.
  2. `apply(vars, overrides, contact, ws)`: no overrides -> `vars` returned byte-identical. Header media mode with a URL sets `header_media_url` and removes any `header_media_id` (a stale id would win). Header text mode renders tokens and replaces `vars.header` only if non-blank. Body/footer: positional overlay - override slot i replaces base slot i when it has content (rendered), otherwise the base value stays; result length = max(base, override). Buttons: matched by BUTTON INDEX (not list position); blank value keeps the template's value; overrides for buttons that are not parameterised are dropped with a warning log `[TPL-OVERRIDE]` (Meta rejects a param for a static button, #132000).
  3. `render(token, contact, ws)`: fast path if no `{{`; every `{{name}}` resolved via `lookup` (contact column, custom attribute, workspace attribute, system token); an unknown token renders EMPTY (shipping raw braces is worse).
  4. `positional(vars)` flattens the section-keyed result to `{"1": v1, "2": v2}` (body only) plus non-array top-level keys, for paths that carry `meta.template_vars` (Team Inbox, chat, Twilio ContentVariables).
  5. Auth templates: the panel is locked and the OTP override is not applied.
  6. A/B campaigns keep variant B's overrides in their own column (`template_overrides_b`, rendered by a second panel with `field=template_overrides_b`); before that column existed variant B was sent variant A's mappings against a different template's variables, producing blank or misplaced values.
  7. Overrides may contain customer data, hence encrypted at rest.
- **Async & events:** none (pure functions).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given override body `["", "SAVE20"]` on a 2-slot template, When applied, Then slot 1 keeps the template mapping and slot 2 is `SAVE20` for every recipient.
  - Given override body `["Hi {{first_name}}"]` and a contact without a first name, When applied, Then the value is `Hi ` (unknown token renders empty).
  - Given a button override for index 2 that is a phone button, When applied, Then it is dropped and a warning is logged.
  - Given a template without overrides, When applied, Then the vars array is unchanged.
- **Source refs:** `app/Services/TemplateOverrideResolver.php`, migrations `2026_07_18_000100_add_template_overrides_to_send_tables.php`, `2026_07_20_140000_add_template_overrides_b_to_wpcampaigns.php`, `app/Http/Controllers/BroadcastsController.php`, `app/Http/Controllers/WaCampaignsController.php`, `app/Http/Controllers/ScheduledController.php`, `app/Http/Controllers/ChatController.php`, `app/Http/Controllers/TeamInboxController.php`, `app/Http/Controllers/Api/ExtensionApiController.php`.
- **Port notes:** put `template_overrides jsonb` on the send-owning tables (`campaigns`, `broadcasts`, `scheduled_messages`, `conversation messages`) and the resolver in the shared template-engine package; Zod-validate on input instead of ad-hoc sanitize.

### WD-TPL-039 — Send-time mapping panel and sendMeta contract

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-TPL-038
- **Summary:** One reusable panel ("Fill in this send - applies to this send only") appears wherever a template is picked for a send. It renders one input per variable slot, header media swap and button link values, with click-to-insert attribute chips, and posts the overrides JSON.
- **Actors & access:** anyone using a template picker (campaign create/edit incl. A/B, broadcasts, scheduled, chat composer, team-inbox composer, Chrome extension).
- **UX & screens:** blade component `resources/views/components/template-live-mapping.blade.php` (props: `templates`, `target` selector, `value`, `field` default `template_overrides`; emits a hidden input and a panel container) and `resources/js/charts/template-live-mapping.js` (`initTemplateLiveMapping`, `mountPanel(panel, meta, initial, onChange)` for surfaces without a form). States: no template selected (hidden); locked notice (auth templates: "Authentication templates send a freshly generated OTP per recipient..."); "no variables, media, or button links to fill in - it sends exactly as written"; full panel with sections Header (text slots or Header media), Message, Footer, Button values. Changing the template clears the overrides. The panel repaints the page's own preview rather than rendering a second one. A blank slot means "fall back to the template's own mapping".
  - Header media upload: drag/drop or pick; per-type limit hints (JPG or PNG up to 5 MB; MP4 up to 16 MB; PDF, DOC or XLS up to 100 MB; audio 16 MB) and client-side size guard before upload; XHR (progress) `POST /api/upload-media` (route owned by FLB/FlowsController, manager+) returns a public URL stored as `header.media_url`.
- **Endpoints:** consumes `POST api/upload-media` (FLB) and `SendAttributes::catalog` (server-rendered into `window.__tlmAttributes`).
- **Data:** `WaTemplate::sendMeta()` per template (server-rendered into `window.__tlmMeta`, also used by `GET chat/api/templates` as `send_meta` and by the extension API): `{id, name, engine, template_type, editable (false for auth), media_editable (non-twilio and header format IMAGE/VIDEO/DOCUMENT), buttons_editable (non-twilio), locked_reason, header:{format TEXT|IMAGE|VIDEO|DOCUMENT, text, slots, tokens:[{name,key,raw}], media_url, defaults}, body:{text, slots, tokens, defaults}, footer:{text, slots, tokens}, buttons:[{index, sub_type (url|copy_code|quick_reply|phone), label, value, editable (url or copy_code only), has_slot}]}`.
- **Rules & edge cases:**
  1. `countSlots` counts every occurrence of a token (`TOKEN_RE`), while `variable_map` de-duplicates, so a repeated token yields more input rows than map entries (QUIRK).
  2. Token labels: a named token shows its own name; a positional token resolves through the variable map to the mapped attribute (`ucfirst(key with spaces)`), otherwise "Value N".
  3. `defaults` pre-fill inputs with `{{key}}` of the current mapping so the operator sees current behavior.
  4. Only url and copy_code buttons are editable; a URL with no `{{` is a fixed link shown read-only; quick-reply payloads and phone buttons are never editable.
  5. Attribute catalog (`SendAttributes::catalog`): groups Contact (name, first_name, last_name, middle_name, title, phone, mobile, country_code, email, address, language, contact_group), Custom field (keys from the last 200 contacts with custom attributes, cached 5 minutes, key regex `^[a-zA-Z_][\w.-]*$`), Workspace (static attributes) and System (today, business_name, company_name); first occurrence of a key wins (contact > custom > workspace > system); sample values come from the latest contact (cached 300 s) and the resolver for system tokens; sample cut to 60 chars.
  6. Twilio: body variables editable; media and buttons locked with the explanation.
  7. Malformed template rows are skipped (reported) so one bad row cannot blank a send page.
  8. Accessibility/keyboard: attribute picker anchored to the focused input, insert at caret.
- **Async & events:** media upload XHR.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a template with 2 body slots mapped to first_name and city, When picked, Then two inputs appear pre-filled with `{{first_name}}` and `{{city}}`.
  - Given the operator types `SAVE20` in slot 2 and leaves slot 1 blank, When the form posts, Then `template_overrides.body = ["", "SAVE20"]`.
  - Given an auth template is picked, When the panel renders, Then it shows the locked notice and posts no overrides.
  - Given a 20 MB video is chosen for an MP4 header, When validated client-side, Then it is rejected before upload (16 MB limit).
- **Source refs:** `resources/views/components/template-live-mapping.blade.php`, `resources/js/charts/template-live-mapping.js`, `app/Models/WaTemplate.php` (sendMeta, countSlots, slotTokens, slotDefaults, buttonMeta), `app/Services/SendAttributes.php`, `app/Http/Controllers/ChatController.php` (templates), `app/Http/Controllers/Api/ExtensionApiController.php` (templates).
- **Port notes:** a shared React component `TemplateSendPanel` fed by `GET /v1/templates/:id/send-meta`; the API owns `sendMeta` so web, extension and mobile stay identical.

### WD-TPL-040 — Template data blob for the Node bridge and scheduler

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-037
- **Summary:** For Baileys/Twilio sends the Node bridge receives the whole template as a `templateData` object, built once per bulk job (workspace attributes substituted; contact-level tokens left for Node), with the attachment inlined as base64. Node can also fetch a template by id over an internal token-gated endpoint.
- **Actors & access:** internal (Laravel to Node); the internal GET is protected by `X-Node-Token`.
- **UX & screens:** none.
- **Endpoints:**
  | METHOD uri                  | route name          | Controller@action        | middleware                                                                                                                                | request fields | response                                                                                                                                                                                                                                                                                                                             |
  | --------------------------- | ------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | GET api/templates-camp/{id} | templates-camp.show | Closure (routes/api.php) | api; header `X-Node-Token` must equal `node_token()` (hash_equals) else 401 `{ok:false,error:'unauthorized'}`; unknown id 404 `not_found` | -              | `{success:true, template:{id, template_name, template_type, category, meta_category, language, header, title_text (=header), template_body, footer, buttons, attachment_type, attachment_file, attachment_url, attachment_base64, attachment_mime, carousel_data, variable_map, meta_template_id, meta_status, twilio_content_sid}}` |
- **Data:** `TemplateDataBuilder::build(template, workspaceId)` returns `{id, template_name, template_type, category, language, header, title_text, template_body, footer, buttons, location (header_location or null), attachment_type, attachment_file, attachment_url, attachment_base64, attachment_mime, carousel_data, variable_map, twilio_content_sid}`.
- **Rules & edge cases:**
  1. The closure endpoint loads `WaTemplate::find($id)` with NO tenant check (it is only reachable with the shared Node token). Its `attachment_url` is `url('storage/'.file)` (public disk) whereas the builder uses `media_url()` (cloud-aware) - the two differ on cloud disks.
  2. `TemplateDataBuilder`: runs `AttributeResolver::resolve` on body, header, footer and each carousel card's title/body/footer with the template's `variable_map` and workspace attributes (positional `{{N}}` mapped to workspace attribute values, then named `{{key}}`); contact-level placeholders that are not workspace attributes remain literal so Node substitutes per recipient. It never throws.
  3. `WaTemplate::inlineAttachment` reads the stored file once and returns `{attachment_base64, attachment_mime}` so Node need not download per recipient (the old per-recipient download dropped media whenever Node could not reach the app URL); on missing/empty/unreadable file it logs `[TEMPLATE-MEDIA]` and returns nulls so Node falls back to `attachment_url`.
  4. Shared by `BroadcastsController::buildTemplateData`, the mobile queue, scheduled sends (`NodeSchedulerClient::resolveTemplateData`) and the campaign path, so all render buttons/media/carousel identically.
  5. Node consumption of buttons: at most 3 (Node formatter chokepoint), text/buttons fallback for Unofficial API.
- **Async & events:** built at job dispatch, not per message.
- **External systems:** Node bridge (`node/services/campaignService.js` fetches `templates-camp`).
- **Settings:** `node_token()` shared secret; media disk.
- **Acceptance criteria:**
  - Given a template with a 2 MB image, When a broadcast is dispatched, Then `templateData` carries the base64 once and `attachment_url` as fallback.
  - Given the body `Hi {{promo_key}} {{name}}` with `promo_key` a workspace attribute, When built, Then `promo_key` is substituted and `{{name}}` stays literal.
  - Given a wrong or missing `X-Node-Token`, When `templates-camp/5` is called, Then 401.
- **Source refs:** `app/Services/Whatsapp/TemplateDataBuilder.php`, `app/Models/WaTemplate.php` (inlineAttachment), `routes/api.php` (templates-camp closure), `app/Services/NodeSchedulerClient.php`, `node/services/campaignService.js`.
- **Port notes:** the NODE domain owns transport auth; expose the template DTO from the templates module (`GET /internal/templates/:id`, service-to-service). Prefer signed media URLs over base64 for large files.

### WD-TPL-041 — Sendable-template pickers for other domains

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TPL-004
- **Summary:** One set of model scopes decides which templates every send picker offers, so Team Inbox, Chat, Broadcasts, Campaigns, Scheduled, Flow builder, Auto-reply, Chrome extension and mobile show identical, engine-correct lists. This is the contract other domains must call.
- **Actors & access:** any picker user; workspace scoped.
- **UX & screens:** picker dropdowns in the consuming screens. The chat picker (`GET chat/api/templates`, CHAT domain) returns `{data:[{id, title, category (effectiveCategory), tone (ucfirst), body, template_type, header, footer, buttons, carousel_data, media_url, media_type, send_meta}]}` sorted by name (case-insensitive), optionally filtered by `category` (all|marketing|utility|authentication, validated). The extension list returns `{id, template_name, template_body, template_type (default 'text'), status, send_meta}`.
- **Endpoints:** the scopes are used by `ChatController@templates`, `ExtensionApiController@templates`, `Api\App\TemplateController@index`, `TemplatesController@apiList`, and (per the model docblock) BroadcastsController, ScheduledController, TeamInboxController, AutoReplyController, WaCampaignsController.
- **Data:** none written.
- **Rules & edge cases:**
  1. `forCurrentWorkspace()`: `workspace_id = current` OR admin global (`workspace_id IS NULL AND user_id IS NULL`) OR legacy user-owned NULL-workspace rows owned by the current user; guests see nothing.
  2. `approved()`: on a WABA-default workspace: `meta_template_id IS NOT NULL AND meta_status = 'APPROVED' AND (paused_until IS NULL OR paused_until <= now)`; on other engines: `status IN (approved, public)`. Then `providerLive()` (drop rows tied to a disconnected/deleted WABA config; NULL provider always kept). This is why synthetic local approvals never leak into a Meta workspace.
  3. Pickers combine `forCurrentWorkspace()->approved()`; `approved()` alone has no tenant filter (see the cross-tenant QUIRK in WD-TPL-017); always combine with the tenant scope.
  4. Category for grouping = `effectiveCategory()` (WD-TPL-003 rule 1); filtering on `meta_category` alone left the chat picker empty for local-template workspaces.
  5. The mobile list accepts `?sendable=0` to bypass `approved()` (management screens) and `account_id` / `sender_key` (`waba:89`) / `X-Device-Id` / `X-Sender-Key` to restrict to one WABA/Twilio account, keeping NULL-`provider_config_id` rows; a bare numeric header is deliberately ignored (devices.id and wa_provider_configs.id collide).
  6. Search/sort on name is done in memory (encrypted column).
  7. Consumers that use only `forCurrentWorkspace()` (for example the booking type template pickers) show unapproved templates too.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace default engine (WorkspaceEngine).
- **Acceptance criteria:**
  - Given a WABA workspace with a Baileys-style approved template lacking `meta_template_id`, When any picker loads, Then it is absent.
  - Given a paused template, When pickers load, Then it is absent until `paused_until` passes.
  - Given a workspace with ten local templates and no `meta_category`, When the chat picker filters by "utility", Then templates whose local category is utility are returned via `effectiveCategory`.
- **Source refs:** `app/Models/WaTemplate.php` (scopeForCurrentWorkspace, scopeApproved, scopeProviderLive, effectiveCategory), `app/Http/Controllers/ChatController.php` (templates), `app/Http/Controllers/Api/ExtensionApiController.php` (templates), `app/Http/Controllers/Api/App/TemplateController.php` (index, resolveAccountId), `app/Http/Controllers/TemplatesController.php` (apiList).
- **Port notes:** implement as repository methods `listSendable(workspaceId, {engine, accountId, category})` in one module; expose on the API and reuse everywhere. Under RLS the "global" starter rows need a permissive read policy but must remain read-only.

### WD-TPL-042 — Single-recipient template send API

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-033
- **Summary:** `POST /api/v1/templates/{id}/send` sends one approved WhatsApp Cloud template to a single number with the caller's own variable values, optional header media (URL or inline upload) and dynamic button parameters.
- **Actors & access:** API clients with a workspace API key (`AuthenticateApiKey`) under `ApiPlanRateLimit` (API domain owns auth/rate limits).
- **UX & screens:** none (documented in the API reference).
- **Endpoints:**
  | METHOD uri                      | route name            | Controller@action              | middleware                                | request fields                                                                                                                                                                                                                                                                                   | response                         |
  | ------------------------------- | --------------------- | ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
  | POST api/v1/templates/{id}/send | api.v1.templates.send | Api\V1\TemplateController@send | api, AuthenticateApiKey, ApiPlanRateLimit | `to` required string max 32; `body` array (list or 1-indexed map) of strings max 1024; `header_text` max 1024; `header_media_url` url max 2048; `header_media` file max 16384 KB (multipart, wins over the URL); `header_filename` max 255; `buttons[]` {`index` int>=0, `sub_type` max 32 (`url | quick_reply`), `value` max 2048} | 201 `{data:{wamid, status:'sent', template_id, template_name, to (digits)}}`; errors: 404 `template_not_found`; 422 with the sender's code (`not_approved`, `paused`, `quality_floor`, `rate_limited`, `no_provider`, `missing_header_media`, `meta_error`) and `extra.template_id`; 422 `unsupported_media_type` |
- **Data:** stores an inline upload in `chat-media/` with a safe name; adds/updates a contact (phone-hash dedupe) via `Contact::rememberPhone`; mirrors the send into the Team Inbox.
- **Rules & edge cases:**
  1. Template lookup: `forCurrentWorkspace()` (own + globals). There is no `approved()` check; gating is by `TemplateSender` (Meta status). QUIRK: a local (Baileys/Twilio) template has synthetic `meta_status=APPROVED`, so it passes the first gate and then goes to Meta under a name that does not exist there (Meta 132001/132000) unless the workspace primary is not a WABA (`no_provider`).
  2. `body` list vs map: a map is sorted by numeric key and re-indexed, so `{"2":"b","1":"a"}` becomes `[a, b]`.
  3. `header_text` maps to `vars.header`; `header_media_url` and `header_filename` pass through; an inline `header_media` is checked by `SecureUpload::problem` (422 `unsupported_media_type` with the reason) and defaults `header_filename` to the client's original name.
  4. Sends through `TemplateSender::send` (all gates and tracking, WD-TPL-033); no override resolution and no attribute lookup: values are exactly what the caller sent.
  5. Contact capture and inbox mirror happen only around the send: contact is remembered for the number regardless of success (before the result check); on success a bubble is appended to an OPEN conversation via `InboxMirror::appendOutboundToOpenConversation` with `allow_create=true` (this is a genuine 1:1 send), body rendered by replacing `{{n}}` in the stored body with the supplied values, `source=api`, `type=template`, template name and buttons. Mirror failures are logged and never fail the API call.
  6. A diagnostic log `[API-V1][TEMPLATE-SEND]` records the outcome (drop in the port; keep structured audit).
- **Async & events:** synchronous; `message_sent` outbound webhook fired by the sender.
- **External systems:** Meta Graph (via sender).
- **Settings:** API plan rate limit; `waba_templates_v2_enabled` is not checked here.
- **Acceptance criteria:**
  - Given an approved WABA template with two body variables, When called with `to` and `body:["Ana","A-12"]`, Then 201 with a wamid and a bubble appears in the inbox.
  - Given a pending template, When called, Then 422 `not_approved`.
  - Given a multipart request with `header_media` PDF, When sent, Then the document header carries the uploaded file's name.
  - Given `body` as `{"1":"Ana"}`, When called, Then it behaves like `["Ana"]`.
- **Source refs:** `app/Http/Controllers/Api/V1/TemplateController.php` (send), `app/Services/Waba/TemplateSender.php`, `app/Services/Inbox/InboxMirror.php`, `app/Support/SecureUpload.php`.
- **Port notes:** publish in the OpenAPI contract; validate that the template is a Cloud API template; queue the send and return 202 with a message id if latency matters (WaDesk is synchronous).

### WD-TPL-043 — REST API v1 template CRUD

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-007
- **Summary:** Public API endpoints list, read, create, update, delete templates and list Meta categories. They re-wrap the mobile-app controller in the `{data}` / `{error}` envelope.
- **Actors & access:** API key holders (workspace scope), plan rate limit; owning domain API for auth/limits, this domain for behavior.
- **UX & screens:** none.
- **Endpoints:**
  | METHOD uri                                     | route name                  | Controller@action                    | middleware                                | request fields          | response                                                                              |
  | ---------------------------------------------- | --------------------------- | ------------------------------------ | ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
  | GET api/v1/templates                           | api.v1.templates.index      | Api\V1\TemplateController@index      | api, AuthenticateApiKey, ApiPlanRateLimit | -                       | `{data:[Template...], meta:{count}}` (sendable-only list, see rule 2)                 |
  | GET api/v1/templates/categories                | api.v1.templates.categories | Api\V1\TemplateController@categories | same                                      | -                       | `{data:[{id:1,name:'Marketing'},{id:2,name:'Authentication'},{id:3,name:'Utility'}]}` |
  | POST api/v1/templates                          | api.v1.templates.store      | Api\V1\TemplateController@store      | same                                      | `StoreTemplateRequest`  | 201 `{data:Template}`; 422 `create_failed` with field errors                          |
  | GET api/v1/templates/{id}                      | api.v1.templates.show       | Api\V1\TemplateController@show       | same                                      | -                       | `{data:Template}` or 404 `not_found`                                                  |
  | PUT api/v1/templates/{id}                      | api.v1.templates.update     | Api\V1\TemplateController@update     | same                                      | `UpdateTemplateRequest` | `{data:Template}`; 422 `update_failed`; 404 `not_found`                               |
  | DELETE api/v1/templates/{id}                   | api.v1.templates.destroy    | Api\V1\TemplateController@destroy    | same                                      | -                       | `{data:{deleted:true, message}}` or 404                                               |
  | (POST api/v1/templates/{id}/send: WD-TPL-042.) |
- **Data:** `Template` resource: `{id, name, type, category, language, header, header_location, body, footer, buttons[], carousel_data, attachment_type, status, created_at, updated_at}`.
- **Rules & edge cases:**
  1. Validation - create: `template_name` required string max 191; `template_type` nullable in standard,carousel,media,auth (no catalog); `category` required (numeric Meta id 1/2/3, a Meta slug, or an industry bucket); `header` nullable max 255; `template_body` required when type is standard, max 4096; `footer` nullable max 255; `language` nullable max 16; `buttons`, `quick_replies`, `carousel_data` nullable (array or JSON string); `latitude` (-90..90) and `longitude` (-180..180) required together; `location_name` max 191; `location_address` max 255; `code_expiration_minutes` (1..90) is forwarded. Update: `template_name`, `category` and `template_body` are all required (a "PUT" is a full replace).
  2. List = the mobile list (sendable only) - i.e. the API returns only Meta-approved/sendable templates for the workspace's engine and cannot list drafts or rejected ones (`sendable=0` is not forwarded).
  3. Only the keys the caller sent are forwarded to the inner controller so an omitted field is not overwritten with null; attachments (image/video/document) cannot be uploaded through the API (dashboard only).
  4. Templates created via the API are stored `status=approved`, `meta_status=APPROVED`, `approved_at=now` and are NEVER submitted to Meta; on a WABA workspace they are not sendable (no `meta_template_id`) - the API cannot create real Cloud API templates (QUIRK). Placeholders are not normalized: named tokens stay named in the stored body; `variable_map` is derived from tokens (single or double braces).
  5. No `PlanLimitGuard` check: API creation ignores the `template` feature flag and `template_limit` (QUIRK bypass); no admin-only guard.
  6. `category` mapping: numeric 1/2/3 -> `meta_category` marketing/authentication/utility; a slug is accepted as `meta_category`; the industry `category` column is only kept if it is one of the seven verticals, else `utility`.
  7. Delete removes stored attachment and carousel images; unknown or foreign ids return 404 `not_found`; bulk delete is not exposed here.
- **Async & events:** none; `LogsNotifications` records.
- **External systems:** none.
- **Settings:** API rate limits.
- **Acceptance criteria:**
  - Given `template_type=standard` and no body, When POST, Then 422 with `template_body` error.
  - Given `category=2`, When created, Then `meta_category=authentication` and `category=utility`.
  - Given latitude without longitude, When POST, Then 422 (`required_with`).
  - Given a foreign template id, When GET, Then 404.
- **Source refs:** `app/Http/Controllers/Api/V1/TemplateController.php`, `app/Http/Requests/Api/V1/Template/StoreTemplateRequest.php`, `app/Http/Requests/Api/V1/Template/UpdateTemplateRequest.php`, `app/Http/Resources/Api/V1/TemplateResource.php`, `app/Http/Controllers/Api/App/TemplateController.php`.
- **Port notes:** implement one templates service used by web, API and mobile; make API creation call the same pipeline as the web (plan checks, normalization, optional Meta submission) and add `submit_to_meta` option. Expose true statuses.

### WD-TPL-044 — Mobile app template API

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TPL-007
- **Summary:** The Flutter mobile app manages templates through `/api/app/*` endpoints with byte-compatible response shapes (`{templates:[...]}`, `{success, message, data}`), workspace-scoped via Sanctum + `ResolveAppWorkspace`.
- **Actors & access:** authenticated app users of the workspace (no role check beyond workspace resolution; owner domain MOB).
- **UX & screens:** none (mobile).
- **Endpoints:**
  | METHOD uri                         | route name | Controller@action                     | middleware                                     | request fields                                                                                    | response                                                                                                                                 |
  | ---------------------------------- | ---------- | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
  | GET api/app/get-templates          | app.       | Api\App\TemplateController@index      | api, Authenticate:sanctum, ResolveAppWorkspace | `sendable` (bool, default true), `account_id`, `sender_key`, headers `X-Sender-Key`/`X-Device-Id` | `{success, account_id, sendable, templates:[presented...]}`                                                                              |
  | GET api/app/get-templates-category | app.       | Api\App\TemplateController@categories | same                                           | -                                                                                                 | `{success, categories:[{id:1,name:'Marketing'},{id:2,name:'Authentication'},{id:3,name:'Utility'}]}`                                     |
  | GET api/app/templates/{id}         | app.       | Api\App\TemplateController@show       | same                                           | -                                                                                                 | `{success, message, data}` or 404 "Template not found or unauthorized"                                                                   |
  | POST api/app/templates-store       | app.       | Api\App\TemplateController@store      | same                                           | multipart; see below                                                                              | `{success, message:'Template created successfully', platform_type:'WA', data}`                                                           |
  | PUT api/app/templates/{id}         | app.       | Api\App\TemplateController@update     | same                                           | as store; `template_name`, `category`, `template_body` required                                   | `{success, message:'Template updated successfully', platform_type:'WA', data}`; not found returns 403                                    |
  | DELETE api/app/templates/{id}      | app.       | Api\App\TemplateController@destroy    | same                                           | -                                                                                                 | `{success, message}`                                                                                                                     |
  | POST api/app/templates/delete      | app.       | Api\App\TemplateController@destroy    | same                                           | `ids[]` (bulk) or `id`                                                                            | `{success, message}` ("Templates deleted successfully" for several); 400 "No template IDs provided."; 404 "No matching templates found." |
- **Data:** the presented template: `id, template_name, template_type, category, meta_category, category_id (1 marketing, 2 authentication, 3 utility), header, header_location, template_body, footer, buttons[], carousel_data[], variable_map[], attachment_type, attachment_file (full URL), attachment_file_path (stored path), language, status, meta_status, account_id (provider_config_id), sender_key ("waba:89", null if the config is gone), meta_template_id, channel (meta|unofficial|twilio), channel_label, channel_code (W|U|T), is_global, created_by, created_by_type (admin|user), created_by_name, created_at, updated_at` (ISO 8601). Engine chip logic: `meta_template_id` set -> Meta; `twilio_content_sid` set -> Twilio; else Unofficial (independent of the `channel` column).
- **Rules & edge cases:**
  1. Store/update validation: `template_name` required max 191; `template_type` nullable in standard,carousel,media,auth; `category` required (numeric id, slug or vertical); `header` max 255; `template_body` required if standard (update: always) max 4096; `footer` max 255; `code_expiration_minutes` 1..90; `language` max 16; `attachment_file` file max 16384 KB; `buttons`/`quick_replies`/`carousel_data`/`header_location` accept arrays or JSON strings (auto-decoded).
  2. Created rows are `status=approved`, `meta_status=APPROVED`, `approved_at=now`, never submitted to Meta (same limitation as WD-TPL-043 rule 4).
  3. Buttons: ready `buttons` array (`type,text,value,url_type,country_code`) OR the parallel-array form, plus `quick_replies` (strings or `{text}`), always appended; capped at 3 (WD-TPL-010). Update replaces buttons only if the request carried any button field (empty result stores NULL).
  4. Location: nested `header_location` or flat `latitude/longitude/location_name/location_address`; invalid coordinates with `attachment_type=location` -> 422 (`errors.latitude`); valid coordinates set `attachment_type=location` and clear the file; update replaces only when location keys were sent, and an explicit other `attachment_type` clears the pin.
  5. File upload replaces the old file (old file deleted); no per-type WhatsApp size check (only the 16 MB validator limit); no carousel image upload endpoint (JSON only).
  6. `variable_map` derived from `{var}`/`{{var}}` tokens in header/body (no normalization, unlike web); on update `variable_map` is reset to the derived value (or NULL).
  7. No plan checks (feature or limit) - same bypass as the API.
  8. Delete removes attachment and carousel card files; workspace-scoped incl. globals (`forCurrentWorkspace`).
  9. Errors return `{success:false, message:'Error <action>', error:<exception message>}` with 500 (leaks exception text).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `?sender_key=waba:89` for a multi-WABA workspace, When listing, Then only templates of account 89 plus NULL-account rows are returned.
  - Given `?sendable=0`, When listing, Then unapproved templates are included.
  - Given `ids[]=3&ids[]=4`, When POST delete, Then both are removed with their media and the message is plural.
  - Given category `1`, When created, Then `meta_category=marketing` and `category_id=1` in the response.
- **Source refs:** `app/Http/Controllers/Api/App/TemplateController.php`.
- **Port notes:** same service as web/API; keep the response compatibility layer in a `mobile` controller so the app keeps working; stop leaking exception messages.

### WD-TPL-045 — Template button-click analytics sync

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TPL-025
- **Summary:** Meta sends no click webhook for WhatsApp template buttons, so the `waba:sync-template-clicks` command polls Meta's `template_analytics` and writes per-campaign click totals to `wpcampaigns.meta_clicked_count` (the UI shows the greater of this and the redirect-based `clicked_count`).
- **Actors & access:** operators/cron (Artisan); no user UI in this domain (campaign analytics screens are CAMP/WABA).
- **UX & screens:** none here; console output lines `#<id> -> <n> clicks` and `Synced N WABA campaign(s).`
- **Endpoints:** command `php artisan waba:sync-template-clicks {--days=14} {--campaign=}`. Note: no schedule is registered (`schedule:list` reports none), so it only runs if someone schedules it or calls it manually.
- **Data:** reads `wpcampaigns` (provider=waba), `wa_templates`; writes `wpcampaigns.meta_clicked_count`, `meta_analytics_synced_at`.
- **Rules & edge cases:**
  1. Selection: provider=`waba` campaigns; with `--campaign` that id only, otherwise those created within `--days` (min 1, default 14), processed newest first in chunks of 100; per-campaign errors are caught and printed.
  2. Templates per campaign: `template_id`, `template_id_a`, `template_id_b` (A/B) that have a `meta_template_id` and `provider_config_id`; grouped by WABA config so one client/call is made per WABA; ids capped at 10 per call.
  3. Window: from the campaign's creation day (start of day) to tomorrow start (exclusive), floored at 89 days back (Meta retention 90 days); granularity DAILY; metrics SENT, DELIVERED, READ, CLICKED via `GET /{waba_id}/template_analytics`.
  4. `sumClicks`: for data points whose template id is among the wanted ids, sums `clicked[*].count` across all buttons and days (or a numeric `clicked`). Attribution is per template per window, not per recipient: two campaigns using the same template on the same days both receive the same clicks (over-count; documented in the code).
  5. If Meta answers that insights are not enabled (message contains "insight", "not enabled" or "analytics") the service calls `POST /{waba_id} {is_enabled_for_insights:true}` once and retries.
  6. Writes even when zero, plus `meta_analytics_synced_at`; a total of NULL is returned for non-WABA campaigns or campaigns whose templates are not on Meta.
  7. `TemplateClient` construction failures are logged and skipped.
- **Async & events:** command / scheduler (to be scheduled in the port).
- **External systems:** Meta Graph `GET /{waba_id}/template_analytics`, `POST /{waba_id}`.
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given a WABA campaign from yesterday with an approved template that got 12 button clicks, When the command runs, Then `meta_clicked_count=12` and the sync timestamp is set.
  - Given Meta reports insights disabled, When the command runs, Then insights are enabled once and the second call's data is used.
  - Given `--campaign=42`, When run, Then only that campaign is synced regardless of age.
- **Source refs:** `app/Console/Commands/SyncWabaTemplateClicks.php`, `app/Services/Waba/MetaTemplateAnalyticsService.php`, `app/Services/Waba/TemplateClient.php` (templateAnalytics, enableInsights).
- **Port notes:** BullMQ repeatable job (e.g. every 6h) scanning last N days; store daily rows (`template_daily_stats`) instead of a single number to allow per-campaign windows; ownership shared with CAMP/WABA.

### WD-TPL-046 — Plan gating and limits for templates

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** -
- **Summary:** Template creation is gated by a boolean plan feature and a numeric cap. Only the web create action enforces them.
- **Actors & access:** workspaces on any plan; platform admins (Spatie role Super Admin/Admin or legacy `users.role` admin) bypass.
- **UX & screens:** nav item "Templates" carries `feature => template` in `UserNav` (hidden when the plan lacks it); a `PlanLimitReachedException` renders 422 JSON or back-with-error (message copies come from PLAN).
- **Endpoints:** enforced in `POST templates` only.
- **Data:** `packages.template` (boolean), `packages.template_limit` (integer), `packages.access_carousel_templates` (boolean); per-workspace `plan_overrides` can flip either through `effectiveLimit`.
- **Rules & edge cases:**
  1. Feature check: `effectiveLimit('template', true)` falsy -> exception `feature_disabled`.
  2. Cap check: `used` = count of ALL `wa_templates` rows with the workspace id (every channel/status, including imported Meta templates; excludes admin globals and legacy NULL-workspace rows); NULL, 0 or negative limit = unlimited; `used >= limit` blocks the create (exception carries key `template_limit`, used, limit). It is a live row count (delete-and-recreate frees quota), unlike quota-ledger metrics.
  3. NOT enforced on: edit, import from Meta, Instaflow sync, API v1 create, mobile create, programmatic creators (invoice/OTP provisioners), or carousel creation (`access_carousel_templates`, documented in Plan Enforcement docs as in-context, but absent from the template code).
  4. Docs statement "Ready-made templates supplied by the platform don't count against your limit" holds (globals have NULL workspace).
  5. Admin package UI lists `template_limit` under "Templates" and `access_carousel_templates` as "Carousel templates".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package columns above.
- **Acceptance criteria:**
  - Given `template_limit=3` and 3 rows, When creating, Then blocked; after deleting one, Then allowed.
  - Given a package with `template=false`, When a manager posts create, Then a feature-disabled error.
  - Given a platform admin, When creating beyond the limit, Then allowed.
  - Given the same workspace calling `POST /api/v1/templates` beyond the limit, Then it succeeds (bypass).
- **Source refs:** `app/Http/Controllers/TemplatesController.php` (store), `app/Services/PlanLimitGuard.php`, `app/Models/Package.php`, `app/Support/UserNav.php`, `Documentation/pages/security/plan-enforcement.html`.
- **Port notes:** centralize in a `PlanEntitlements` guard called by the single templates service so every entry point (web, API, mobile, import) is covered; decide whether imports count.

### WD-TPL-047 — Global starter library seed

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** -
- **Summary:** A platform-level starter set of 12 sample templates (no owner) is seeded so every new workspace sees ready-made examples in the library; they are the "global pool".
- **Actors & access:** super-admin/installer (seeder), all workspaces read.
- **UX & screens:** appear in the library for non-WABA workspaces (approved/public only) and for WABA workspaces only if they carry real Meta ids (they do not, so they are hidden there).
- **Endpoints:** none (seeder `WaTemplateSeeder`, called from `DatabaseSeeder`).
- **Data:** wipes `wa_templates` (`WaTemplate::query()->delete()`) and inserts 12 rows with `user_id=null`, `workspace_id=null`, `template_type=standard`, `language=en_US`, `channel=null`, no `meta_*` ids: Pre-Travel_Reminder, Booking_Confirmation, Last_Minute_Deal (pending, marketing), Prescription_Renewal, Appointment_Reminder, Appointment_Confirm, Class_Reminder, Students_Welcome (pending, marketing), Course_Enrollment, Order_Shipped, Diwali_Drop_VIP (pending, marketing), Loan_Status_Update (rejected with reason "Body too generic..."). Verticals: travel(3), healthcare(3), education(3), ecommerce, festival, finance; `meta_category` utility or marketing; bodies use named `{{name}}`-style tokens and are not positional. `approved_at` = random 1-30 days ago for approved rows.
- **Rules & edge cases:**
  1. Seeder is destructive: re-running deletes ALL templates of ALL workspaces (QUIRK; safe only on fresh installs). Local DB shows exactly these 12 rows (8 approved, 3 pending, 1 rejected).
  2. Globals are visible to and mutable by every workspace manager (WD-TPL-018 rule 1) and cannot be sent through Meta (no Meta id).
  3. Marketing landing copy advertises "71 starters" (component `feature-templates`, CMS domain) while the seeder ships 12 (marketing claim is not backed by data).
  4. Other demo seeders: `InstagramTemplateShowcaseSeeder`, `TelegramShowcaseSeeder` (workspace-scoped, upsert by workspace+channel+name).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh install seeded, When any Baileys workspace opens the library, Then 8 starter templates are visible (approved) and 4 are hidden.
  - Given a WABA workspace, When it opens the library, Then no starter appears.
- **Source refs:** `database/seeders/WaTemplateSeeder.php`, `database/seeders/DatabaseSeeder.php`, `database/seeders/InstagramTemplateShowcaseSeeder.php`, `database/seeders/TelegramShowcaseSeeder.php`.
- **Port notes:** ship the starters as read-only platform templates (`is_platform=true`, no tenant) that a workspace can "use as a starting point" (clone) - never editable in place; write real Meta-approvable sample copy.

### WD-TPL-048 — Platform flags and settings for templates

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** -
- **Summary:** A handful of `system_settings` keys govern Meta submission, sweeping, lint, Graph version and daily caps. Only some are actually read.
- **Actors & access:** super-admin (Admin > Settings > WhatsApp/channel settings, `AdminPagesController` channel-setting tab).
- **UX & screens:** channel-setting page: toggle "waba_templates_v2_enabled" (Enabled/Disabled label), number input `waba_template_polling_min`, toggle `waba_template_lint_strict` (view `resources/views/admin/settings/channel-setting.blade.php`, owned by SET/ASHELL).
- **Endpoints:** saved by the admin providers form (`AdminPagesController` validation: `waba_templates_v2_enabled` sometimes boolean; `waba_template_polling_min` sometimes integer 5..240; `waba_template_lint_strict` sometimes boolean; `waba_graph_api_version` nullable regex `^v\d{1,2}\.\d{1,2}$`; `waba_app_id` nullable max 64).
- **Data:** `system_settings(key,type,value,description)`. Keys and defaults:
  - `waba_templates_v2_enabled` (bool, default false): master switch for Meta template submission (create/resubmit), edit push, page-load sweep, and PHP-side WABA template sending: `WaCampaignsController` refuses a Cloud template campaign with "WhatsApp Cloud template sending is disabled platform-wide" when off, while `BroadcastsController` only skips its PHP pre-flight/pre-build of per-recipient Meta payloads when off (templates with media headers, buttons or carousels are pre-built regardless because the Node bridge cannot render them; simple text templates are then built by Node itself). `importFromMeta` and `refresh` do not check it.
  - `waba_graph_api_version` (default `v23.0`), `waba_app_id` (platform Meta App ID, used as last-resort upload app).
  - `waba_template_daily_cap` (int, default 0 = off): read by the sender; no admin UI writes it.
  - `waba_link_tracking_enabled` (bool, default true): link wrapping for URL button values.
  - DEAD: `waba_template_polling_min` (default 30) and `waba_template_lint_strict` (default true, described as "warnings block submit") are persisted and displayed but never read by template code.
- **Rules & edge cases:**
  1. In the local reference DB none of these keys are present, so every default applies: template submission and WABA sending are OFF until an admin enables the flag. In that state creating a template on a WABA channel falls back to `baileys` (WD-TPL-007 rule 2).
  2. When the flag is off the detail page shows no Submit control and `syncStale` returns `enabled:false`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** as listed.
- **Acceptance criteria:**
  - Given the flag is off, When a manager creates a template on the default channel, Then it is saved as a local `baileys` template (approved) and nothing is sent to Meta.
  - Given the flag is on and a WABA connected, When the same is done with channel waba, Then Meta is called.
  - Given `waba_template_lint_strict` is toggled, When linting, Then behavior is unchanged (dead setting).
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (~L1455-1465, 1597-1600, 1735-1738), `app/Http/Controllers/TemplatesController.php`, `app/Services/Waba/TemplateSender.php`, `app/Services/Waba/TemplateSyncSweeper.php`, `app/Services/Waba/LinkTracker.php`.
- **Port notes:** replace the flag with proper capability detection (a WABA account connected + app credentials present); implement lint-strict and polling interval for real or remove them.

### WD-TPL-049 — Legacy chat_templates snippets

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** -
- **Summary:** `chat_templates` / `ChatTemplate` was the first "canned message" table (title, category, tone, body, optional media) for the chat page picker. The chat picker now reads `wa_templates`, leaving this table unused except for seed data and a notification label.
- **Actors & access:** none (no controller, route or view).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `chat_templates(id, user_id null, title varchar(255), category varchar(32), tone varchar(32) null, body text, media_path varchar(255) null, media_type varchar(16) null, status varchar(16) default 'approved', timestamps)`; indexes on user_id, category, status. `ChatTemplate::CATEGORIES = [marketing, utility, authentication]`; scopes `approved()` (approved|public) and `ofCategory`. Seed (`ChatSeeder`) inserts 8 rows (3 marketing, 3 utility, 2 authentication: "New Year VIP offer", "Flash sale reminder", "Back in stock", "Order update", "Delivery slot confirmation", "Support follow-up", "Login code", "Password reset"). `NotificationHelper` maps the model name to a "Chat template" notification pointing at `/chat`.
- **Rules & edge cases:**
  1. Nothing reads or writes the table at runtime; `TeamInboxController` comments confirm it uses `WaTemplate` instead of the "simpler ChatTemplate snippets".
  2. Do not port; keep as a migration note only.
- **Async & events:** `LogsNotifications` trait is applied but nothing creates rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh port, When the chat template picker loads, Then it reads the unified templates table and there is no `chat_templates` table.
- **Source refs:** `app/Models/ChatTemplate.php`, `database/migrations/2026_05_05_000003_create_chat_templates_table.php`, `database/seeders/ChatSeeder.php`, `app/Helpers/NotificationHelper.php`.
- **Port notes:** if canned replies ("quick replies/snippets") are wanted, model them in the chat/inbox domain, not here.

### WD-TPL-050 — Change notifications on template writes

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** -
- **Summary:** `WaTemplate` (and `ChatTemplate`) use the `LogsNotifications` trait, so every Eloquent create, update and delete of a template records an in-app notification entry via `NotificationHelper::record`.
- **Actors & access:** automatic; entries appear in the notification center of the acting user/workspace (NOTIF domain).
- **UX & screens:** notification row with noun "Template", category `template`, icon `template`, link `/templates/{id}/edit`.
- **Endpoints:** none.
- **Data:** notification rows in NOTIF tables.
- **Rules & edge cases:**
  1. Fires for all events (`created`, `updated`, `deleted`) because the model does not override `$notifyEvents`.
  2. Because status sync, sweeper, webhook and import writes are plain Eloquent updates, they also generate "updated" notifications (noisy; there is no user context in webhook/worker paths, behavior of `record` without an auth user belongs to NOTIF). `saveQuietly` is used only by the one-off variable-map backfill migration.
  3. No dedicated notification for "template approved/rejected" exists.
- **Async & events:** in-process model events.
- **External systems:** none.
- **Settings:** notification preferences (NOTIF).
- **Acceptance criteria:**
  - Given a manager creates a template, When saved, Then a "Template created" notification links to its edit page.
  - Given a webhook flips a template to APPROVED, When applied, Then an "updated" notification entry is produced (port: replace with a dedicated `template.approved` notification).
- **Source refs:** `app/Models/Concerns/LogsNotifications.php`, `app/Models/WaTemplate.php`, `app/Helpers/NotificationHelper.php`.
- **Port notes:** emit domain events (`template.created|updated|deleted|status_changed`) through the outbox and let the notifications module subscribe; do not use model hooks.

## Data model

### wa_templates (owned; model `WaTemplate`)

Purpose: every reusable outbound message template of every channel, plus the platform-owned starter library (rows with `workspace_id IS NULL AND user_id IS NULL`). Read/written by WD-TPL-001..048 (reads also by all send domains). Volume: tens to low thousands per workspace; global starters 12. Timestamps `created_at`/`updated_at`; NO soft delete; deletes are hard.

Columns (MySQL final shape; encrypted = Laravel `encrypted` cast storing ciphertext in TEXT/LONGTEXT, therefore not searchable/sortable/unique in SQL):

| Column                                                  | Type / null / default                                                     | Behavior                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                                      | bigint unsigned PK                                                        |                                                                                                                                                     |
| user_id                                                 | bigint unsigned null                                                      | creator; NULL for global starters and some imports                                                                                                  |
| workspace_id                                            | bigint unsigned null, FK workspaces ON DELETE SET NULL                    | owner tenant; NULL = global; deleting a workspace orphans its templates into the "global" pool (QUIRK: they become visible to everyone if approved) |
| provider_config_id                                      | bigint unsigned null, indexed, no FK                                      | which WABA config the template lives on; NULL for non-WABA. Dangling ids are hidden by `providerLive()`                                             |
| meta_template_id                                        | varchar(64) null, UNIQUE (global)                                         | Meta's id; the only trustworthy "exists on Meta" signal; unique across ALL tenants                                                                  |
| twilio_content_sid                                      | varchar(64) null, indexed (plaintext)                                     | `HX` + 32 hex                                                                                                                                       |
| channel                                                 | varchar(16) null, indexed                                                 | baileys, waba, twilio, instagram, facebook, telegram, line, wechat, viber (sms accepted on create)                                                  |
| meta_status                                             | varchar(32) null, indexed; index (provider_config_id, meta_status)        | PENDING, APPROVED, REJECTED, IN_APPEAL, PENDING_DELETION, DELETED, DISABLED, PAUSED, LIMIT_EXCEEDED, FLAGGED. Synthetic APPROVED on local channels  |
| quality_score                                           | varchar(16) null                                                          | UNKNOWN, GREEN, YELLOW, RED                                                                                                                         |
| rejection_reason_code                                   | varchar(64) null                                                          | Meta enum (ABUSIVE_CONTENT, INVALID_FORMAT, PROMOTIONAL, TAG_CONTENT_MISMATCH, SCAM, NONE)                                                          |
| rejection_reason                                        | text null, encrypted                                                      | local human note (manual reject / seeds)                                                                                                            |
| template_name                                           | text NOT NULL, encrypted                                                  | display name; no uniqueness; Meta name = slug of it                                                                                                 |
| category                                                | varchar(32) NOT NULL default `utility`, indexed; index (category, status) | overloaded: industry vertical (travel, healthcare, education, ecommerce, festival, finance, utility) OR a WhatsApp category on some writers         |
| meta_category                                           | varchar(32) null                                                          | marketing, authentication, utility (lowercase from forms/importer; UPPERCASE after refresh/webhook - inconsistent)                                  |
| template_type                                           | varchar(32) NOT NULL default `standard`                                   | standard, carousel, media, auth, catalog (`media` never created by the web UI)                                                                      |
| header                                                  | text null, encrypted                                                      | text header (or intro header for carousel)                                                                                                          |
| header_location                                         | text null, encrypted array                                                | `{latitude, longitude, name?, address?}`                                                                                                            |
| template_body                                           | text NOT NULL, encrypted                                                  | body with positional `{{n}}` (web) or raw named tokens (API/mobile)                                                                                 |
| footer                                                  | text null, encrypted                                                      |                                                                                                                                                     |
| code_expiration_minutes                                 | smallint unsigned null                                                    | 1-90 (auth)                                                                                                                                         |
| buttons                                                 | longtext null, encrypted array                                            | see WD-TPL-010 shapes; max 3 via UI                                                                                                                 |
| carousel_data                                           | longtext null, encrypted array                                            | `[{title, body, image, buttons[]}]`                                                                                                                 |
| variable_map                                            | longtext null, encrypted array                                            | `{header:[{num,key}], body:[{num,key}], cards?, url_<i>?}`                                                                                          |
| attachment_type                                         | varchar(16) null                                                          | none, image, video, document, audio, location (legacy: media, text)                                                                                 |
| attachment_file                                         | varchar(255) null                                                         | disk-relative path (`wa-templates/...`); carousel images inside `carousel_data`                                                                     |
| header_sample_url                                       | text null                                                                 | Meta's approved sample URL captured on import                                                                                                       |
| language                                                | varchar(16) NOT NULL default `en_US`                                      | Meta language code; self-healed to the base code after a 132001                                                                                     |
| parameter_format                                        | varchar(16) NOT NULL default `POSITIONAL`                                 | POSITIONAL or NAMED                                                                                                                                 |
| status                                                  | varchar(16) NOT NULL default `pending`, indexed; index (user_id, status)  | pending, approved, rejected, public                                                                                                                 |
| approved_at, submitted_at, last_synced_at, paused_until | timestamp null                                                            | lifecycle stamps; `paused_until` gates sending                                                                                                      |

Other indexes: user_id; workspace_id; provider_config_id; channel; twilio_content_sid. Referenced by: `booking_templates.wa_template_id` (FK SET NULL); soft references (no FK, dangling on delete): `broadcasts.template_id`, `wpcampaigns.template_id/_a/_b`, `scheduled_messages.template_id`, `messages.template_id`, `inbox_messages.template_id`, `keyword_reply_contents.template_id`, `facebook/line/telegram/viber/wechat_broadcasts.template_id`, `shopify_integration_events.template_id`, `woocommerce_integration_events.template_id`, `invoice_settings.template_id_whatsapp`, `wa_link_clicks.template_id`, flows (JSON node config), incoming webhook `template_config`.
Send-owning columns written by this domain's override feature but living on other tables: `broadcasts.template_overrides`, `scheduled_messages.template_overrides`, `wpcampaigns.template_overrides`, `wpcampaigns.template_overrides_b` (longText, encrypted array, nullable).
Port: Postgres table `message_templates` with plain columns for searchable fields (name, channel, statuses, categories, language), JSONB for `buttons`, `carousel`, `variable_map`, `header_location`; `tenant_id` NOT NULL for tenant rows plus a separate `platform_templates` table (or `tenant_id NULL` + RLS read-only policy) for starters; unique `(waba_account_id, meta_template_id)`; index `(tenant_id, channel, status)`, `(tenant_id, meta_status)`, `(tenant_id, lower(name))`.

### chat_templates (owned; model `ChatTemplate`) - dead

Columns: id, user_id null, title varchar(255), category varchar(32) (marketing|utility|authentication), tone varchar(32) null, body text, media_path varchar(255) null, media_type varchar(16) null, status varchar(16) default `approved`, timestamps; indexes user_id, category, status. 8 seeded rows; unused at runtime (WD-TPL-049).

### Shared/not owned but touched

`flow_templates` (admin flow starters; FLB), `booking_templates` (APPT: lifecycle message mapping to `wa_template_id`, `plain_body`, `variable_map`, coupon), `wa_provider_configs` (WABA), `system_settings` (SET), `packages` (PLAN), `attributes`/`contacts` (CON), `wa_products`/`wa_catalogs` (CAT), `wa_link_clicks` (WABA).

## Cross-domain contracts

Consumes:

- WABA (`whatsapp-cloud-api-waba`): `WaProviderConfig` (status connected, `is_primary`, `credentials_json` with `access_token`, `waba_id`, `app_id`, `phone_number_id`, `meta_json.verified_name`), `WabaIdBackfiller::resolve`, `LinkTracker::wrap/enabled`, `MetaError::describe`, Graph version setting, inbound webhook receiver that must call this domain's lifecycle handler (WD-TPL-029), `WebhookService::dispatch('message_sent')`.
- WADEV/NODE (`whatsapp-devices-baileys`, `node-bridge-runtime`): Node consumes `templateData` (WD-TPL-040) and `templates-camp/{id}`; Node's formatter limits buttons to 3 and drops media/buttons/carousel for simple broadcast payloads unless PHP pre-builds Meta payloads.
- CON: `GET /attributes/api/list`, `AttributesController::validatePlaceholders`, `AttributeResolver`, `attribute-picker.js`, `Contact::rememberPhone`, contact fields used as variables.
- PLAN: `PlanLimitGuard::feature/check`, package columns `template`, `template_limit`, `access_carousel_templates`.
- AIADM: `AiKeyResolver`, `AiAgentService::callProvider`, `admin_ai_keys`, `ai_provider_keys`.
- SET: `media_disk()`, `media_url()`, `media_storage()`, system settings UI for `waba_*` keys.
- WALLET: `MessageBillingService::payPerMessageFor`, `MessageCreditRate::displayForCategory` for the cost chip.
- CAT: `wa_products`, `wa_catalogs` for catalog templates.
- INTG/API/MOB/EXT: transports, auth and rate limits for their template endpoints.
- FLB: `POST api/upload-media` used by the send-time panel; flow builder consumes `/templates/api/list`.

Exposes:

- To every send domain (BCAST, CAMP, SCHED, CHAT, TIB1/TIB2, FLR/FLB, AR, APPT, INV, ECOM, mobile, extension): `WaTemplate` scopes `forCurrentWorkspace()`, `approved()`, `providerLive()`; `engineKey()`; `effectiveCategory()`; `sendMeta()`; `buttonSubType()`; `inlineAttachment()`; `TemplateSender::send/sendMany`; `TemplatePayloadBuilder::buildSend`; `TemplateOverrideResolver::sanitize/apply/render/lookup/positional/flattenMap/normalizeKey/TOKEN_RE`; `BroadcastsController::varsForRecipient` (re-home into a shared service); `TemplateDataBuilder::build`; `SendAttributes::catalog`; `TemplateLinter`, `TemplateClient` (used by INV/AUTH provisioners for programmatic WABA template creation).
- To BCAST/CAMP: `meta_clicked_count` sync (WD-TPL-045).
- To NOTIF: `LogsNotifications` events (WD-TPL-050).
- To API/MOB: the behaviors in WD-TPL-042/043/044 (transport-level auth/rate limiting stays in those domains).
- Programmatic template creators (outside this domain): `Invoice\InvoiceTemplateProvisioner` (INV, creates + submits a UTILITY invoice template with a URL button), `AdminPagesController::createOtpTemplate` (AUTH/SET, OTP login template), `Auth\RegistrationOtpService` (reads a configured template by id).

## Open questions & quirks

1. SECURITY (cross-tenant read): `show`/`edit` fall back to `approved()->findOrFail($id)` without tenant filter, so any approved/public template of another workspace is readable (and its edit form renderable) by id on non-WABA workspaces. Update/delete are tenant-scoped but include admin globals, so any manager can mutate/delete the shared starter rows. The port must scope by tenant and make globals read-only.
2. SECURITY/CORRECTNESS: `destroy` returns `statusCounts(WaTemplate::query()->get())` over all tenants; the endpoint also has no usage check for campaigns/flows referencing the template.
3. Entry-point drift: only the web create path enforces `template` feature and `template_limit`, normalizes placeholders, lints and submits to Meta. API v1 and mobile creation skip all of that, store rows as locally approved (never on Meta), and keep named tokens un-normalized. Decide one pipeline for the port.
4. `meta_status=APPROVED` is meaningless on non-WABA rows (synthetic; also back-filled by migration). Always require `meta_template_id` for Meta sends. API v1 single-send does not check this and will attempt Meta sends for local templates.
5. `meta_category` casing is inconsistent (lowercase from forms/importer, UPPERCASE from refresh/sweeper/webhook), which can hide templates from category tabs after a sync; normalize to one case.
6. Variable-mapping panel for named tokens is ignored by the server (`variable_map_json` only read for purely positional bodies); header and body share one slot namespace in the legacy path. Verify live before deciding what to port.
7. Blank header/footer text and removing all buttons cannot be saved through the edit form (null-dropping validator + "button fields present" condition). Verify live; likely bug.
8. Location header: linter blocks WABA submission (no file) and the builder emits an empty `header_handle` for LOCATION; effectively location works only for non-WABA channels.
9. Dynamic URL buttons (URL with `{{n}}`) always fail lint in the UI because the required example (`variable_map.url_<i>`) has no input; carousel per-card variables (`variable_map.cards[i].body`) also have no writer.
10. Authentication templates cannot be authored correctly in the web UI (no OTP button fields; form posts `template_type=standard`), although linter/builder/import/send support `auth`. Docs describe an "Authentication type" flow that does not exist. The `media` template type is documented but never created by the UI.
11. Plan flag `access_carousel_templates` is not enforced. Admin settings `waba_template_polling_min` and `waba_template_lint_strict` are stored but unused; `waba_template_daily_cap` has no admin UI and is not enforced in batch sends. The "tracked short link is created at template-create time for placeholder URLs" comment in the sender is not implemented in the builder.
12. `TemplateSender` messages say caps reset "at midnight UTC" while the counter key uses the app timezone date.
13. Instaflow sync uses `updateOrCreate` on an encrypted `template_name` column, which cannot match reliably (likely duplicates on re-sync). Verify live.
14. Imported catalog/flow/MPM/voice-call buttons collapse into generic quick replies; imported carousels have no card images; editing an imported OTP/catalog template rewrites its buttons to the first select option.
15. Dead/unused UI: "Save draft" button, `existing_attachment_file` hidden field, `templates/api/{id}/preview`, `approve`/`reject` endpoints, the `approved|pending|rejected|mine` convenience routes, the `qualityMeetsFloor` helper, `ChatTemplate`. The WaDesk docs mention approve/reject "for your own" workflow that has no UI.
16. Seeder `WaTemplateSeeder` wipes all `wa_templates` rows on run; marketing copy claims 71 starters but only 12 exist.
17. `LogsNotifications` produces an "updated" notification for every sync write (status refreshes included); confirm the expected behavior with NOTIF.
18. Seeded permissions `templates.view|create|edit|delete` exist but no route or policy checks them; routes rely solely on `workspace.role:manager`. Decide whether to map them to the new RBAC.
19. Routes owned by other domains but essential here: `POST webhooks/whatsapp/inbound` (WABA, contains `applyTemplateUpdate`), `GET chat/api/templates` and `POST chat/api/conversations/{id}/template` (CHAT), `POST api/app/chats/{id}/template` (MOB), `GET api/get-templates` (EXT), `POST webhooks/incoming/{id}/template-send` (INTG), `POST api/upload-media` (FLB), `POST flows/templates/{id}/clone` and `admin/flow-templates*` (FLB flow templates, not message templates), `POST invoices/template` (INV), `POST admin/settings/channel-setting/otp-template` (AUTH/ASHELL). They are referenced, not claimed.
20. `Api\V1` and `Api\App` template routes and `api/templates-camp/{id}` are listed in this file's coverage because their business rules are template rules; API, MOB and NODE domains should reference these features rather than restate them.
21. `wa_templates.meta_template_id` UNIQUE is global; the same WABA cannot sync templates in two workspaces (importer blocks the later one). Port the "one workspace per WABA" rule at connection time.
22. LINE, WeChat and Viber templates can be created (by URL `?channel=`), stored and filtered (`channel=line|wechat|viber`) but have no library tab, no modal card, and their card chip falls back to the "Unofficial" style; SMS rows resolve to the Unofficial label via `engineKey()`.
23. Marketing component `components/frontend/feature-templates.blade.php` and admin `flow-templates` views are not message templates; left to CMS and FLB.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET templates",
    "POST templates",
    "GET templates/create",
    "GET templates/approved",
    "GET templates/pending",
    "GET templates/rejected",
    "GET templates/mine",
    "GET templates/api/list",
    "GET templates/api/ai-models",
    "POST templates/api/ai-generate",
    "GET templates/api/{id}",
    "POST templates/api/{id}/preview",
    "POST templates/import-from-meta",
    "POST templates/sync-instaflow",
    "POST templates/sync-stale",
    "GET templates/{id}",
    "PUT templates/{id}",
    "DELETE templates/{id}",
    "POST templates/{id}/approve",
    "GET templates/{id}/edit",
    "POST templates/{id}/refresh",
    "POST templates/{id}/reject",
    "POST templates/{id}/submit",
    "GET api/templates-camp/{id}",
    "GET api/v1/templates",
    "POST api/v1/templates",
    "GET api/v1/templates/categories",
    "GET api/v1/templates/{id}",
    "PUT api/v1/templates/{id}",
    "DELETE api/v1/templates/{id}",
    "POST api/v1/templates/{id}/send",
    "GET api/app/get-templates",
    "GET api/app/get-templates-category",
    "POST api/app/templates-store",
    "POST api/app/templates/delete",
    "GET api/app/templates/{id}",
    "PUT api/app/templates/{id}",
    "DELETE api/app/templates/{id}"
  ],
  "controllers": [
    "app/Http/Controllers/TemplatesController.php",
    "app/Http/Controllers/Api/App/TemplateController.php",
    "app/Http/Controllers/Api/V1/TemplateController.php"
  ],
  "services": [
    "app/Services/TemplateOverrideResolver.php",
    "app/Services/SendAttributes.php",
    "app/Services/Waba/MetaTemplateAnalyticsService.php",
    "app/Services/Waba/TemplateClient.php",
    "app/Services/Waba/TemplateImporter.php",
    "app/Services/Waba/TemplateLinter.php",
    "app/Services/Waba/TemplatePayloadBuilder.php",
    "app/Services/Waba/TemplateSender.php",
    "app/Services/Waba/TemplateSyncSweeper.php",
    "app/Services/Whatsapp/TemplateDataBuilder.php"
  ],
  "models": ["WaTemplate", "ChatTemplate"],
  "tables": ["wa_templates", "chat_templates"],
  "views": [
    "resources/views/user/templates/_cards.blade.php",
    "resources/views/user/templates/create.blade.php",
    "resources/views/user/templates/edit.blade.php",
    "resources/views/user/templates/index.blade.php",
    "resources/views/user/templates/show.blade.php",
    "resources/views/components/template-live-mapping.blade.php"
  ],
  "commands": ["waba:sync-template-clicks"],
  "permissions": ["templates.view", "templates.create", "templates.edit", "templates.delete"],
  "middleware": [],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/template-live-mapping.js",
    "resources/js/charts/user-templates-create.js",
    "resources/js/charts/user-templates-edit.js",
    "resources/js/charts/user-templates-index.js",
    "resources/js/charts/user-templates-show.js",
    "resources/js/template-var-map.js",
    "resources/js/template-vars.js"
  ],
  "misc_files": [
    "app/Http/Requests/Api/V1/Template/StoreTemplateRequest.php",
    "app/Http/Requests/Api/V1/Template/UpdateTemplateRequest.php",
    "app/Http/Resources/Api/V1/TemplateResource.php"
  ],
  "config_files": [],
  "doc_pages": ["Documentation/pages/automation/templates.html"],
  "feature_map": {
    "WD-TPL-001": [
      "GET templates",
      "GET templates/approved",
      "GET templates/pending",
      "GET templates/rejected",
      "GET templates/mine"
    ],
    "WD-TPL-006": ["GET templates/create"],
    "WD-TPL-007": ["POST templates"],
    "WD-TPL-016": ["GET templates/api/ai-models", "POST templates/api/ai-generate"],
    "WD-TPL-017": ["GET templates/{id}"],
    "WD-TPL-018": ["GET templates/{id}/edit", "PUT templates/{id}"],
    "WD-TPL-020": ["DELETE templates/{id}"],
    "WD-TPL-021": ["POST templates/{id}/approve", "POST templates/{id}/reject"],
    "WD-TPL-022": [
      "GET templates/api/list",
      "GET templates/api/{id}",
      "POST templates/api/{id}/preview"
    ],
    "WD-TPL-025": ["POST templates/{id}/submit"],
    "WD-TPL-026": ["POST templates/{id}/refresh"],
    "WD-TPL-027": ["POST templates/sync-stale"],
    "WD-TPL-028": ["POST templates/import-from-meta"],
    "WD-TPL-032": ["POST templates/sync-instaflow"],
    "WD-TPL-040": ["GET api/templates-camp/{id}"],
    "WD-TPL-042": ["POST api/v1/templates/{id}/send"],
    "WD-TPL-043": [
      "GET api/v1/templates",
      "POST api/v1/templates",
      "GET api/v1/templates/categories",
      "GET api/v1/templates/{id}",
      "PUT api/v1/templates/{id}",
      "DELETE api/v1/templates/{id}"
    ],
    "WD-TPL-044": [
      "GET api/app/get-templates",
      "GET api/app/get-templates-category",
      "POST api/app/templates-store",
      "POST api/app/templates/delete",
      "GET api/app/templates/{id}",
      "PUT api/app/templates/{id}",
      "DELETE api/app/templates/{id}"
    ],
    "WD-TPL-045": []
  }
}
```
