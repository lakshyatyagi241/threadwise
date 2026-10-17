---
domain: broadcasts
code: BCAST
title: WhatsApp Broadcasts (template bulk sends, delivery tracking, retry, link clicks)
threadwise_version: '1.7.0'
sources_read: 62
---

# WhatsApp Broadcasts (template bulk sends, delivery tracking, retry, link clicks)

## Overview

A **broadcast** is a one-shot bulk send of a single approved WhatsApp template (or, for the SMS and Instagram variants, a plain message) to a list of contacts, with per-recipient delivery tracking (queued, sent, delivered, read, failed, clicked). It lives under More > Broadcasts (`/broadcasts`). It is distinct from _campaigns_ (`wa-campaigns`, domain `campaigns`) which are the richer, recurring/attribute-driven blast tool, and from _scheduled messages_ (`scheduled`, domain `scheduled-queue-warmer`) which are free-form one-off/recurring sends. Channel-specific broadcasts for Telegram, LINE, Viber, WeChat and Facebook have their own controllers, views and tables and belong to their channel domains (they are only linked from the New-broadcast chooser here). `Api/V1/BroadcastController` (REST API) delegates to the code documented here and belongs to `developer-rest-api-v1`. The mobile app (`mobile-app-api`) re-uses the same `broadcasts` table as its "message queues".

Actors:

- **Workspace owner / admin** (the only workspace roles that can open the pages; manager, agent, viewer cannot). Platform super-admins bypass the role gate. Plan tiers gate the feature (`packages.broadcast` flag) and cap the number of broadcast rows (`packages.broadcast_limit`).
- **Node bridge** (`node-bridge-runtime`): does the actual sending on the Unofficial (Baileys), WABA (Meta Cloud) and Twilio engines and calls Laravel back per recipient and once per run.
- **Meta / Twilio status webhooks**: advance delivered/read/failed on the recipient rows (documented in `whatsapp-cloud-api-waba`; the broadcast-specific branch is described here).
- **End customer**: receives the message and may tap a tracked link (`/r/{token}`).

Main flow end to end:

1. Admin opens `/broadcasts/create`, names the broadcast, picks an approved template (optionally overriding variables at send time), picks one or more connected senders (with share weights), picks contacts / groups / tags and either "send now" or a future date/time/timezone.
2. `POST /broadcasts` runs plan gates, resolves the audience (workspace scoped, opted-out contacts removed), wallet precheck, template pre-flight guards, WhatsApp Warmer hold/reservation, splits the audience across senders by weight, creates one `broadcasts` row per sender plus one `broadcast_contacts` row per recipient (status `pending`), then hands each slice to the Node bridge (`/api/broadcast/send-immediate|schedule/{senderPhone}`), or to a PHP runner for SMS.
3. Node paces the sends (jittered gap, optional batches, Baileys daily cap), reports each recipient (`POST api/update-message-status`) and a final run status (`POST api/update-broadcast-status`). Meta/Twilio/Baileys receipts advance delivered/read; cached aggregate counters on the `broadcasts` row are recomputed; billing settles; sends are mirrored into open team-inbox threads; outbound webhooks fire.
4. The list page (poll 15s) and the detail page (poll 12s) show progress. Admin can export a per-recipient CSV, retry failed recipients (manual, or automatically via the Node-heartbeat-driven sweeper), or delete a scheduled/failed broadcast.

Plan tiers: `packages.broadcast` (boolean, default off) enables the feature (Feature check throws a plan-limit error; the in-app paywall sheet from `config/plan_gates.php` overlays `/broadcasts*` for plans without it); `packages.broadcast_limit` (int, 0 = unlimited) caps the number of broadcast rows in the workspace; `packages.broadcast_size_limit` ("Recipients per broadcast") exists in the plan editor but is **not enforced anywhere** (TW-BCAST-041). Per-workspace `plan_overrides` can override flags/limits and the retry policy.

Connections to other domains (by id): `whatsapp-devices-baileys` (WADEV, sender devices), `whatsapp-cloud-api-waba` (WABA, templates, provider configs, status webhooks, WorkspaceEngine), `node-bridge-runtime` (NODE, heartbeat, sockets, settings), `message-templates` (TPL, template model/approval/variable map/live-mapping component), `contacts-attributes-tags` (CON, contacts, groups, tags, opt-out flag), `wallet-message-billing` (WALLET, precheck + settlement), `plans-subscriptions-trials` (PLAN, limits and paywall), `scheduled-queue-warmer` (SCHED, WarmerService and the "audience queue" picker that reads completed broadcasts), `campaigns` (CAMP, shares link tracking, retry policy and the `/r/{token}` counters), `team-inbox-conversations` (TIB1, InboxMirror), `notifications-activity-audit` (NOTIF), `integrations-hubspot-slack-trello-google-webhooks` (INTG, outbound webhooks), `channel-sms` (SMS runner, sender), `channel-instagram` (IG DM client), `mobile-app-api` (MOB, "queues" reuse of the table), `developer-rest-api-v1` (API), `platform-settings-branding-storage` (SET, node URL/token and pacing settings).

Read this before rebuilding (highest-impact quirks, details in the features and the quirks section): (a) scheduled WhatsApp broadcasts exist **only in Node process memory** and are lost on restart (TW-BCAST-021); (b) scheduled **SMS** broadcasts are sent immediately (TW-BCAST-020); (c) the chosen timezone does not shift the schedule instant on the Laravel side (TW-BCAST-015); (d) Node's `paused` status is rejected by Laravel validation so pauses never persist (TW-BCAST-022/026); (e) the list KPI tiles Processing/Queued read the wrong table (TW-BCAST-002); (f) scheduled-message-contacts is read by broadcast id (id-namespace collision with scheduled messages, TW-BCAST-027/032).

## Feature index

| Id           | Feature                                                                                      | Status      | Priority | Effort | Depends on                 |
| ------------ | -------------------------------------------------------------------------------------------- | ----------- | -------- | ------ | -------------------------- |
| TW-BCAST-001 | Broadcast list page: filters, search, range, pagination, live refresh                        | implemented | P0       | M      | TW-BCAST-002, TW-BCAST-015 |
| TW-BCAST-002 | List KPI strip and status-count aggregation                                                  | partial     | P0       | S      | TW-BCAST-027               |
| TW-BCAST-003 | New-broadcast channel chooser                                                                | implemented | P1       | S      | -                          |
| TW-BCAST-004 | Compose page: data loading, defaults and layout                                              | implemented | P0       | M      | -                          |
| TW-BCAST-005 | Template picker, live phone preview and send-time overrides                                  | implemented | P0       | M      | TW-BCAST-004               |
| TW-BCAST-006 | Sender picker with multi-device share weights                                                | implemented | P0       | M      | TW-BCAST-004               |
| TW-BCAST-007 | Audience picker: contacts, groups and tags                                                   | implemented | P0       | M      | TW-BCAST-004               |
| TW-BCAST-008 | Schedule selector: send now or later                                                         | implemented | P0       | S      | TW-BCAST-004               |
| TW-BCAST-009 | Store request: authorization, plan gates and validation                                      | implemented | P0       | M      | -                          |
| TW-BCAST-010 | Audience resolution, workspace scoping and opt-out removal                                   | implemented | P0       | M      | TW-BCAST-009               |
| TW-BCAST-011 | Wallet precheck before a blast (and what the SendGate does not do)                           | partial     | P0       | S      | TW-BCAST-009               |
| TW-BCAST-012 | Template pre-flight guards (auth block, media reachability, WABA quality)                    | implemented | P0       | M      | TW-BCAST-009               |
| TW-BCAST-013 | WhatsApp Warmer hold and budget reservation                                                  | implemented | P1       | M      | TW-BCAST-010               |
| TW-BCAST-014 | Multi-device audience split and per-sender fan-out                                           | implemented | P0       | M      | TW-BCAST-010, TW-BCAST-006 |
| TW-BCAST-015 | Persisting broadcasts and recipient rows; schedule instant                                   | partial     | P0       | M      | TW-BCAST-014               |
| TW-BCAST-016 | Bridge dispatch to Node: sender resolution, payload, failure states                          | implemented | P0       | L      | TW-BCAST-015               |
| TW-BCAST-017 | Per-recipient WABA template payload pre-build (variables, overrides, OTP, buttons, carousel) | implemented | P0       | L      | TW-BCAST-016               |
| TW-BCAST-018 | Link-click tracking: wrapping, redirect endpoint and counters                                | implemented | P1       | L      | TW-BCAST-016               |
| TW-BCAST-019 | Instagram reply-only broadcast                                                               | implemented | P2       | M      | TW-BCAST-004               |
| TW-BCAST-020 | SMS broadcast runner (PHP transport)                                                         | partial     | P1       | M      | TW-BCAST-015               |
| TW-BCAST-021 | Node broadcast scheduler endpoints and in-memory schedule store                              | partial     | P0       | L      | TW-BCAST-016               |
| TW-BCAST-022 | Node send loop: engine routing, pacing, batching, daily cap, socket-drop pause               | partial     | P0       | L      | TW-BCAST-021               |
| TW-BCAST-023 | Node message rendering per engine (Baileys, WABA, Twilio)                                    | implemented | P0       | L      | TW-BCAST-022               |
| TW-BCAST-024 | Baileys delivery and read receipt forwarding                                                 | implemented | P0       | M      | TW-BCAST-022               |
| TW-BCAST-025 | Per-recipient status callback (Node to Laravel)                                              | implemented | P0       | L      | TW-BCAST-022               |
| TW-BCAST-026 | Run-level status callback (Node to Laravel)                                                  | partial     | P0       | S      | TW-BCAST-022               |
| TW-BCAST-027 | Aggregate counters, status state machine and provider status webhooks                        | partial     | P0       | M      | TW-BCAST-025               |
| TW-BCAST-028 | Team-inbox mirroring of broadcast sends                                                      | implemented | P1       | M      | TW-BCAST-025               |
| TW-BCAST-029 | Outbound webhooks and in-app notifications emitted by broadcasts                             | implemented | P1       | M      | TW-BCAST-015, TW-BCAST-025 |
| TW-BCAST-030 | Detail page shell: header, KPI tiles, tabs and live poll                                     | implemented | P0       | M      | TW-BCAST-035               |
| TW-BCAST-031 | Detail overview tab: delivery curve, status donut, funnel, template preview                  | implemented | P1       | M      | TW-BCAST-030               |
| TW-BCAST-032 | Detail recipients tab                                                                        | implemented | P0       | M      | TW-BCAST-030               |
| TW-BCAST-033 | Detail failures tab and failure-reason histogram                                             | implemented | P1       | S      | TW-BCAST-030               |
| TW-BCAST-034 | Detail events tab                                                                            | implemented | P2       | S      | TW-BCAST-030               |
| TW-BCAST-035 | Live-stats JSON endpoint                                                                     | implemented | P0       | S      | TW-BCAST-025               |
| TW-BCAST-036 | Statistics JSON endpoint                                                                     | implemented | P2       | S      | TW-BCAST-025               |
| TW-BCAST-037 | Per-recipient CSV export                                                                     | implemented | P1       | S      | TW-BCAST-032               |
| TW-BCAST-038 | Manual retry of failed recipients                                                            | implemented | P0       | M      | TW-BCAST-016               |
| TW-BCAST-039 | Automatic retry sweeper with backoff                                                         | implemented | P1       | M      | TW-BCAST-038               |
| TW-BCAST-040 | Delete a scheduled or failed broadcast                                                       | implemented | P0       | M      | TW-BCAST-021               |
| TW-BCAST-041 | Recipients-per-broadcast plan cap (advertised, not enforced)                                 | docs-only   | P1       | S      | TW-BCAST-009               |
| TW-BCAST-042 | Click analytics surfaces (list column, recipient clicks; header tile missing)                | partial     | P2       | S      | TW-BCAST-018               |
| TW-BCAST-043 | Demo seed data (BroadcastSeeder)                                                             | implemented | P2       | S      | -                          |

## Features

### TW-BCAST-001 — Broadcast list page: filters, search, range, pagination, live refresh

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-002, TW-BCAST-015
- **Summary:** The landing page of the feature (`/broadcasts`, "Template broadcasts"). It lists every broadcast of the current workspace, newest first, with a status sidebar, time-range pills, name search, a KPI strip and per-row funnel numbers. The list refreshes itself every 15 seconds without a page reload.
- **Actors & access:** Workspace roles owner or admin (`workspace.role:admin` middleware; platform admins bypass; agent/viewer are redirected to `/team-inbox` with a warning flash; manager gets HTTP 403). The plan flag `packages.broadcast` drives the paywall sheet (path glob `broadcasts` and `broadcasts/*` in `config/plan_gates.php`): the page still renders and an upgrade sheet slides over it. Workspace-shared visibility: every admin in the workspace sees every broadcast regardless of who created it (pre-migration rows with null workspace_id fall back to their creator).
- **UX & screens:** `resources/views/user/broadcasts/index.blade.php` + partial `_rows.blade.php`, JS `resources/js/charts/user-broadcasts-index.js` (page key `user-broadcasts-index`). Layout: left sidebar with a "Tip" box, a "Broadcast views" card (buttons All broadcasts, Scheduled, Processing, Completed, Failed, each with a count badge from TW-BCAST-002), a "Recent broadcasts" card (first five rows of the current filtered page, each shows the delivered number; the rows link to `#` and have a `data-recent-broadcast` hook that no JS wires up, effectively dead links) and a "Create broadcast" call-to-action card. Main area: header "Template broadcasts" with workspace name, Refresh button (re-fetches, shows a short "Refreshed" toast) and "New broadcast" (link, or the channel chooser modal, TW-BCAST-003); a six-tile KPI strip (Sent, Delivered, Read, Failed, Processing, Queued); a card "Recent broadcasts" with range pills (All time, 7d, 30d, 90d), a search input ("Search broadcasts") and a list/grid view toggle (`x-list-grid-toggle`, storage key `broadcasts`); a table with columns Name, Template, Contacts, Sent, Delivered, Read, Failed, Clicked, Status, Schedule and a row-action column; a footer "Showing X of Y filtered broadcasts" (hidden when the filtered total is 0); pagination; three static help cards. Row: name plus a provider chip (`baileys` shown as "Unofficial API", `waba` "WABA", `twilio` "Twilio", anything else, including `sms`, shows a dash) and the label "Broadcast #BR-0001" (id zero-padded to 4 digits); template name from one batched lookup (fallback "Template #<id>", dash when none); Contacts = `total_recipients`; Sent/Delivered/Read/Failed/Clicked from the `status_counts` accessor (TW-BCAST-027; failed and clicked are coloured when > 0); status badge (ucwords of the status with underscores as spaces; completed=dark, completed_with_errors and scheduled=amber, processing=green, failed=red, unknown=grey); Schedule cell shows "Today, HH:MM" or "Mon DD, HH:MM" from `scheduled_at` (raw stored time, no timezone conversion) or a dash; actions: "View analytics" (to the detail page), "Export rows" (CSV download), Delete (only when status is scheduled or failed; opens a confirm dialog "Delete broadcast?" with danger tone, then DELETE, then re-fetches the list; failure toast "Delete failed: ..."). Empty state: "No broadcasts match the current filters. Try clearing filters or create your first broadcast." with reset (`/broadcasts`) and create buttons. States: loading = list gets 60% opacity during a fetch; error = toast "Could not refresh: <reason>"; the URL is kept in sync with `history.pushState` (`?status=&range=&q=&page=`) and `popstate` re-fetches.
- **Endpoints:**

| Method uri     | Route name            | Controller@action          | Middleware                              | Request                                                                                                        | Response                                                                                                         |
| -------------- | --------------------- | -------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET broadcasts | user.broadcasts.index | BroadcastsController@index | Authenticate, EnsureWorkspaceRole:admin | query `status` (default all), `range` (all/7d/30d/90d), `q`, `page`, `partial=1` or `Accept: application/json` | HTML page, or JSON `{ok, rows (rendered HTML rows), stats, statusCounts, pagination (HTML), shown, total, page}` |

- **Data:** reads `broadcasts` (workspace scope + engine scope, see rules), `wa_templates.template_name` for the row labels, `system_settings`/`wa_provider_configs`/`telegram bots`/`workspace_ig_accounts` for the chooser. Ordered by id descending. Page size 12.
- **Rules & edge cases:**
  1. The controller loads **all** broadcasts of the workspace into memory, filters them in PHP (status equality, created_at >= cutoff, name substring) and only then paginates the collection at 12 per page. Search is done in PHP because `name` (and `timezone`) are encrypted at rest and cannot be matched in SQL. The port should store the name in plaintext (or a search-friendly column) and filter in SQL.
  2. `status` filter: `all` or any string; any value is compared for equality with `broadcasts.status`. Known values: scheduled, processing, completed, completed_with_errors, failed. The sidebar has no pill for completed_with_errors even though `statusCounts` includes it (its rows appear only under All or via URL). Unknown `range` values are ignored (treated as all).
  3. Search: case-insensitive `mb_strtolower` substring on the decrypted name; trimmed; empty = no filter.
  4. Page number is clamped into [1, last page]; the paginator keeps all query parameters except `page` and `partial`.
  5. Engine scope: only rows whose `provider` is in the workspace's enabled engine set (`WorkspaceEngine::enginesFor`) are listed (`forCurrentEngine`); rows with a null or disabled provider are hidden. Consequence: the seeded demo rows (no provider, no workspace) never show.
  6. Because the mobile app stores its "queues" as `broadcasts` rows, those rows also appear here (QUIRK, see Data model).
  7. JSON mode is chosen by `Accept: application/json`/`X-Requested-With` (wantsJson) or `partial=1`. The JS always sends `partial=1` and Accept JSON.
  8. Poll: every 15 000 ms, skipped while the tab is hidden; an immediate fetch when the tab becomes visible; interval cleared on `pagehide`. Search input debounce 220 ms; any filter change resets page to 1.
  9. The "Sent" tile sub-label shows the number of broadcasts (`stats.total`), not sent messages.
- **Async & events:** none server-side; client polling only.
- **External systems:** none.
- **Settings:** `telegram_enabled`, `sms_enabled` (system settings) only influence the chooser (TW-BCAST-003).
- **Acceptance criteria:**
  - Given a workspace with 30 broadcasts, When an admin opens `/broadcasts`, Then 12 rows are shown newest first, the footer reads "Showing 12 of 30 filtered broadcasts" and pagination shows 3 pages.
  - Given the admin clicks the "Failed" pill and types "may" in search, When the debounce fires, Then only failed broadcasts whose decrypted name contains "may" (case-insensitive) are shown, the URL becomes `?status=failed&q=may` and the tiles/pill counts are unchanged (they are workspace-wide).
  - Given a user with workspace role agent, When they open `/broadcasts`, Then they are redirected to `/team-inbox` with the warning "Your role (agent) doesn't have access to that page."
  - Given a broadcast is processing on Node, When 15 seconds pass with the tab visible, Then the row counts and status update without a page reload; with the tab hidden no request is made.
  - Given a request with `Accept: application/json` and `partial=1`, When the server responds, Then the body contains `ok`, `rows`, `stats`, `statusCounts`, `pagination`, `shown`, `total`, `page`.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (index, statusCounts), `app/Http/Controllers/Controller.php` (paginateCollection), `app/Models/Broadcast.php` (scopes, filterByName), `app/Models/Concerns/HasEngineScope.php`, `resources/views/user/broadcasts/index.blade.php`, `resources/views/user/broadcasts/_rows.blade.php`, `resources/js/charts/user-broadcasts-index.js`, `routes/web.php` (line 635 group), `config/plan_gates.php`, `Documentation/pages/messaging/broadcasts.html`.
- **Port notes:** New module `apps/api/src/modules/broadcasts`; table `broadcasts` with `workspace_id` + RLS. Do server-side filtering and pagination (12 default, allow `page_size`). Keep the JSON shape only if the web client needs it; a Next.js list can call a normal paginated endpoint. Workspace role check maps to the RBAC domain (owner/admin). The engine scope should become a plain `provider IN (...)` filter or be dropped (decide with WABA/WADEV owners). Polling can become SSE/websocket later, keep 15 s polling as the baseline.

### TW-BCAST-002 — List KPI strip and status-count aggregation

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-BCAST-027
- **Summary:** The six tiles above the broadcast list and the per-status counts on the sidebar pills. Sent, Delivered, Read and Failed are correct workspace totals from cached counters; Processing and Queued are read from a table that current sends never write, so they are effectively always zero.
- **Actors & access:** Same as TW-BCAST-001 (data is returned by the same endpoint).
- **UX & screens:** Tiles (`index.blade.php`): Sent (with "N broadcasts"), Delivered (with "x% delivery"), Read ("x% read rate"), Failed ("x% failed"), Processing ("in flight"), Queued ("awaiting send"). Client JS (`applyCounts`) recomputes the three percentages from the returned numbers.
- **Endpoints:** same as TW-BCAST-001 (returned inside `stats` and `statusCounts`).
- **Data:** `broadcasts` (sum of `success_count`, `delivered_count`, `read_count`, `fail_count`, `clicked_count`, `total_recipients`) filtered by workspace_id (or by user_id when the user has no workspace id); `scheduled_message_contacts` joined to `broadcasts` on `smc.scheduled_message_id = broadcasts.id`.
- **Rules & edge cases:**
  1. Tile values are workspace-wide sums over all the workspace's broadcasts (ignore the status/range/search filter) using the cached aggregate columns; they match the per-row numbers because both come from the same columns.
  2. `stats.total` = number of broadcasts in the workspace (engine-scoped list). `stats.recipients` (sum of total_recipients) and `stats.clicked` are returned but not rendered as tiles.
  3. Percentages: delivery% = delivered / sent; read% = read / delivered; failed% = failed / sent (denominator is Sent, not audience). All rounded to 1 decimal, 0 when the denominator is 0.
  4. Processing = count of `scheduled_message_contacts` rows with status `sent` and no delivered_at and no failed_at; Queued = count with status `pending`. QUIRK: WhatsApp broadcasts write recipient state to `broadcast_contacts`, never to `scheduled_message_contacts`, so these two tiles stay 0 except by accident of id collision with `scheduled_messages` (TW-BCAST-027). A rebuild should derive them from `broadcast_contacts` (`pending` = queued; `sent` not yet delivered = in flight) or drop the table dependency.
  5. `statusCounts` = counts of broadcasts by status for keys all, scheduled, processing, completed, completed_with_errors, failed (statuses outside this list, such as paused, are only in `all`).
  6. The engine scope is applied to the list but the stats query is only workspace scoped, so tile sums can include broadcasts of a disabled engine that the list hides.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two broadcasts with success_count 10 and 5, delivered_count 8 and 4, When the list loads, Then Sent shows 15, Delivered 12 and "80.0% delivery".
  - Given a broadcast with 0 sent and 3 failed, When the tiles render, Then Failed shows 3 and "0.0% failed" (denominator 0 guards to 0).
  - Given a new immediate broadcast whose recipients are all `pending` in `broadcast_contacts`, When the list loads, Then (Reference behavior) Queued shows 0 (documented quirk; the port should show the pending count).
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (statsForUser, statusCounts), `resources/views/user/broadcasts/index.blade.php`, `resources/js/charts/user-broadcasts-index.js` (applyCounts).
- **Port notes:** Compute tiles in one SQL aggregate per workspace; fix Processing/Queued to read recipient rows of the new table. Keep counters cached on the broadcast row (see TW-BCAST-027) or use a materialized view; RLS on both tables.

### TW-BCAST-003 — New-broadcast channel chooser

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** -
- **Summary:** When the workspace has more than one broadcast-capable channel connected, "New broadcast" opens a modal to pick the channel; otherwise it goes straight to the WhatsApp composer.
- **Actors & access:** Owner/admin of the workspace (page is `workspace.role:admin`).
- **UX & screens:** Modal `#bc-channel-modal` in `index.blade.php`, closed by the X button or by clicking the backdrop. Cards: **WhatsApp** (always; link `/broadcasts/create`), **SMS** (shown when `sms_enabled` system setting is on and the workspace has a connected `wa_provider_configs` row with provider `sms`; link `/broadcasts/create?channel=sms`), **Telegram** (shown when `telegram_enabled` is on and a Telegram bot is connected for the workspace; link to the Telegram broadcast page `user.telegram.broadcasts`, owned by `channel-telegram`), **Instagram** (shown when a Workspace IG account is connected; link `/broadcasts/create?channel=instagram`). If none of SMS/Telegram/Instagram is available the modal is not rendered and "New broadcast" is a plain link. Facebook, LINE, Viber and WeChat have no card here; they are reached from their own menus.
- **Endpoints:** none of its own (uses `GET broadcasts/create`, TW-BCAST-004).
- **Data:** reads `system_settings` (`telegram_enabled`, `sms_enabled`), `wa_provider_configs` (provider = sms, connected), Telegram bot connection helper, `workspace_ig_accounts` connected helper.
- **Rules & edge cases:**
  1. The chooser is evaluated server side when the list renders (not from the JSON partial).
  2. `channel` query values other than `sms` and `instagram` fall back to WhatsApp.
  3. All copy is translatable strings; the cards state "no template approval" for SMS, Telegram and Instagram.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `telegram_enabled`, `sms_enabled` (admin settings, default off).
- **Acceptance criteria:**
  - Given SMS is enabled and a Twilio SMS number is connected, When the admin clicks "New broadcast", Then the modal shows WhatsApp and SMS cards and the SMS card links to `?channel=sms`.
  - Given none of SMS, Telegram or Instagram is connected, When the admin clicks "New broadcast", Then the browser navigates directly to `/broadcasts/create`.
  - Given the modal is open, When the admin clicks the dark backdrop, Then it closes without navigating.
- **Source refs:** `resources/views/user/broadcasts/index.blade.php`, `app/Http/Controllers/BroadcastsController.php` (create, channel handling).
- **Port notes:** Channel availability should come from the channel domains (feature flags + connection state). Keep the modal in the web app; the composer receives `channel` as a query param.

### TW-BCAST-004 — Compose page: data loading, defaults and layout

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** -
- **Summary:** `GET /broadcasts/create` renders the two-column composer ("Create new broadcast"): the form on the left, a sticky WhatsApp-style preview on the right. The controller pre-loads everything the form needs.
- **Actors & access:** Owner/admin (`workspace.role:admin`). No plan gate on viewing the page (the paywall sheet may overlay it).
- **UX & screens:** `resources/views/user/broadcasts/create.blade.php`, JS `resources/js/charts/user-broadcasts-create.js`. Sticky top bar: back arrow to `/broadcasts`, breadcrumb "Broadcasts / New", title "Create new broadcast", a "Draft / unsaved" pill (static text, nothing is ever saved as draft) and a submit button "Add Broadcast" bound to the form by `form="broadcastForm"`. Flash banners: `session('error')` (red) and the first validation error. Section 01 "Broadcast setup": Broadcast name (required, placeholder e.g. "May offer template send", help "Internal label used in broadcast reports."), Select template message (TW-BCAST-005), device picker (TW-BCAST-006), audience (TW-BCAST-007), schedule (TW-BCAST-008). The right panel shows the phone preview plus two stat boxes "Selected" (count) and "Schedule" (Now/Later). Instagram variant swaps template and device pickers for "Send from" (IG account), a Message textarea and IG chats (TW-BCAST-019).
- **Endpoints:**

| Method uri            | Route name             | Controller@action           | Middleware                              | Request                                            | Response                                                                                                                                       |
| --------------------- | ---------------------- | --------------------------- | --------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GET broadcasts/create | user.broadcasts.create | BroadcastsController@create | Authenticate, EnsureWorkspaceRole:admin | query `channel` = sms or instagram (else WhatsApp) | HTML view with contacts, groups, templates, devices, timezones, defaultTz, tags, tagCounts, broadcastChannel, igAccounts, igChats, igTemplates |

- **Data:** reads contacts (workspace, newest 500), contact_groups (workspace, ordered by `user_group`), wa_templates (workspace-visible incl. admin-seeded global templates, `approved()` scope, with provider relation, newest first), senders from `WorkspaceEngine::senders` (all enabled engines plus sms), tags (workspace, ordered by name) with distinct-contact counts from `contact_tag` joined to contacts, workspace timezone, `workspace_ig_accounts`, `conversations`, IG-channel templates.
- **Rules & edge cases:**
  1. Contacts list is capped at the newest 500 by id (orderByDesc id, limit 500). QUIRK: a workspace with more than 500 contacts cannot pick older contacts individually (groups and tags still reach them). A rebuild should add server-side search or pagination in the picker.
  2. Sender list per channel: WhatsApp channel shows every connected sender of every enabled engine except SMS numbers; `channel=sms` shows only SMS numbers. Each entry: composite `key` (`engine:id`), `id`, `label`, `phone`, `engine`, `engineLabel`, `is_default`, `status=connected`. Only connected senders are returned by the source of truth.
  3. Default timezone = workspace timezone, else the user's timezone, else `app.timezone`. The timezone select lists all PHP IANA identifiers. Default send date = today in that timezone, default time = now + 30 minutes (`Y-m-d`, `H:i`).
  4. Instagram: accounts are the workspace's connected IG accounts (`instaflow_account_id`, handle shown as `@username-or-name`). Chats per account are `conversations` of channel instagram whose `raw_jid` starts with `ig:<accountId>` followed by a separator (the id's `%`, `_` and `\` are LIKE-escaped, one wildcard char absorbs the `:` or `_` separator), newest inbound first, max 2000 per account, title fallback "Instagram user". IG templates are templates whose `engineKey()` is `instagram` (id, name, body, buttons).
  5. Tag counts count distinct contacts per tag within the workspace.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none specific.
- **Acceptance criteria:**
  - Given a workspace on a WABA number and a Baileys device, When the admin opens `/broadcasts/create`, Then the sender list shows both grouped under "Meta"/"Unofficial API" headers with composite keys like `waba:7` and `baileys:12`.
  - Given a workspace timezone `Asia/Kolkata`, When the page loads, Then the timezone select is preselected to it and the date defaults to today in that zone.
  - Given `?channel=sms`, When the page loads, Then only SMS numbers appear as senders and no WhatsApp sender does.
  - Given a session error flash, When the page renders, Then a red banner shows it above the form.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (create), `resources/views/user/broadcasts/create.blade.php`, `resources/js/charts/user-broadcasts-create.js`, `app/Services/WorkspaceEngine.php` (senders), `routes/web.php`.
- **Port notes:** Split the preload into separate typed endpoints (contacts search, groups, tags with counts, approved templates, senders) instead of a giant server-rendered page. Senders come from WADEV/WABA modules. Keep composite `engine:id` sender keys or replace with a UUID sender id.

### TW-BCAST-005 — Template picker, live phone preview and send-time overrides

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-004
- **Summary:** The operator chooses an approved template and sees exactly what recipients will get, and may override variable values, header media and button links for this send only, without editing the template.
- **Actors & access:** Owner/admin composing a broadcast.
- **UX & screens:** Select `#templateSelect` (`name=template_id`, HTML `required`, first option "— Pick an approved template —"). Option label: template name, plus the connected WABA number label when the template belongs to a WABA provider config, plus (only when Twilio is among enabled engines) " ✓ Twilio ready" when the template has a `twilio_content_sid` or " · plain text only" when it does not. Option data attributes carry body, header, footer, category (meta_category, then category, default utility), template type (default standard), provider config id, twilio ContentSid flag, buttons JSON, attachment type, attachment URL (`media_url`), variable map JSON. Below the select: the `x-template-live-mapping` panel (owned by `message-templates`) which edits per-send overrides and posts them as the string field `template_overrides` (hidden for authentication templates). Empty state: "No approved templates yet." with link "Create one" to `/templates/create`; Twilio workspaces get a paragraph about Content SIDs; otherwise "Broadcasts send approved templates only." Preview (right column): media header (image shows the image capped at ~150px height; video/document show a labelled chip "Video preview"/"Document preview"; other attachment kinds show a capitalised chip), header text (bold), body with sample values, footer, one chip per template button (icons: link for `visit_website`, phone for `call_phone`, copy for `copy_code`, reply arrow otherwise; buttons without text are skipped), category chip capitalised (dash when no template), bubble timestamp = current local time. Sample values: `fillSamples(text, {valueByKey, slotMap})` from `resources/js/template-vars.js`; positional `{{1}}` resolves via the template variable map flattened from `{header:[{num,key}], body:[{num,key}]}`; real workspace attribute demo values are fetched with `loadAttributeValues()` and the preview repaints when they arrive; empty body shows "(empty body)".
- **Endpoints:** none of its own (values are submitted with TW-BCAST-009).
- **Data:** field `template_id` (int), `template_overrides` (JSON string). See TW-BCAST-017 for the overrides shape and how they apply.
- **Rules & edge cases:**
  1. Only approved templates are offered (`WaTemplate::approved()` scope, workspace-visible including global admin-seeded ones; the exact "approved" definition belongs to `message-templates`).
  2. The HTML `required` on the select is client-only; the server accepts a missing template (TW-BCAST-009 rule 6).
  3. The preview is display-only; nothing in it touches the send path.
  4. Instagram channel has no template picker (its own message box, TW-BCAST-019).
- **Async & events:** none (attribute values fetched by XHR).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a template with header, body `Hi {{1}}`, footer and two buttons, When the admin selects it, Then the preview shows header, sample-filled body, footer and two button chips with the right icons and the category chip.
  - Given a template with an IMAGE header, When selected, Then the preview shows the image; given a VIDEO header, Then it shows a "Video preview" chip.
  - Given no approved templates exist, When the page loads, Then the select has only the placeholder option and the "Create one" link is shown.
  - Given the admin clears the selection, When the change event fires, Then the preview resets to "Pick a template to preview…" and the category chip to a dash.
- **Source refs:** `resources/views/user/broadcasts/create.blade.php`, `resources/js/charts/user-broadcasts-create.js`, `resources/js/template-vars.js`, `resources/views/components/template-live-mapping.blade.php` (owned by `message-templates`), `app/Services/TemplateOverrideResolver.php`.
- **Port notes:** Reuse the template preview component from the templates module. Overrides are validated server-side in TW-BCAST-017; keep the JSON contract.

### TW-BCAST-006 — Sender picker with multi-device share weights

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-004
- **Summary:** Pick one or many connected senders (numbers) across engines. With several ticked, each gets a share weight controlling what fraction of the audience it sends; live percentages update as weights change.
- **Actors & access:** Owner/admin composing.
- **UX & screens:** Block `[data-device-picker]`, label "Send from device(s) *" with a "Multi-device — tick all that apply" hint when more than one sender exists. States: **none connected**: red box "No connected devices." with a "Connect one" button (`data-connect-device`, opens the global connect-device popover; the picker is refreshed in place afterwards); **exactly one**: a static row showing label and phone plus a hidden `device_ids[]` input carrying the composite key; **two or more**: scrollable checkbox list (max height 14rem), grouped under sticky engine headers (labels like "Unofficial API", "Meta", "Twilio") only when 2+ engines are present; each row is a checkbox `device_ids[]` value `engine:id` and a weight input `device_share[engine:id]` (number, default 1, min 0, step 1, width 3.5rem) that is dimmed and disabled-looking until the row is ticked, plus a live percentage badge (weight / sum of ticked weights, rounded; dash when unticked; "0%" when weight is 0 or the sum is 0). Help text: "Tick devices and set share weights, e.g. 7 / 3 sends 70% of contacts via the first device and 30% via the second. Equal weights split evenly."
- **Endpoints:** none of its own (submitted with TW-BCAST-009).
- **Data:** POST fields `device_ids[]` (strings <=64 chars, composite `engine:id`), `device_share` map, legacy `device_id`.
- **Rules & edge cases:**
  1. The JS never parses the key; keys are opaque strings because device ids and provider-config ids overlap across engines.
  2. Nothing forces at least one ticked box in a multi-sender list. Submitting with none ticked (or with zero connected devices) creates a single **device-less** broadcast; at dispatch Reference falls back to the workspace's newest connected Baileys device (TW-BCAST-016).
  3. Weight inputs allow 0 in the UI but the server treats a non-positive weight as 1 (TW-BCAST-014).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two connected senders, When the admin ticks both and sets weights 7 and 3, Then the badges show 70% and 30%.
  - Given one connected sender, When the page renders, Then no checkbox list is shown and the form posts that sender's key automatically.
  - Given no connected sender, When the page renders, Then "No connected devices." and the connect action are shown.
  - Given one row is unticked, When weights change, Then its badge shows a dash and its weight input is non-interactive.
- **Source refs:** `resources/views/user/broadcasts/create.blade.php`, `resources/js/charts/user-broadcasts-create.js` (recalcSharePcts), `app/Services/WorkspaceEngine.php`.
- **Port notes:** Sender list belongs to WADEV/WABA. Require at least one sender server-side in the rebuild (Reference's silent legacy fallback is surprising); keep weights >= 0 with 0 meaning "skip".
- **Carry-over:** `/broadcasts/create` redirects to `/campaigns/create`, and the share picker now lives in the Campaign wizard's step 1 (TW-CAMP-042, [campaigns inventory](campaigns.md)); the old composer screen was removed. In the wizard a weight of 0 counts as 1, as on the server.

### TW-BCAST-007 — Audience picker: contacts, groups and tags

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-004
- **Summary:** The audience step lets the operator combine tags, contact groups and individually ticked contacts; a counter shows how many contacts are ticked directly.
- **Actors & access:** Owner/admin composing.
- **UX & screens:** Heading "Who do you want to send it to?", subtitle "Pick contacts directly or pick a contact group.", counter `#selectedSummary` "N selected". **Tags row** (only if the workspace has tags; not shown for Instagram): chips with a colour dot (tag colour or a default brand colour), name and the distinct-contact count; checkboxes `tags[]` (restored from old input after a failed submit). **Groups row** (only if groups exist): chips `groups[]` labelled with `user_group` or "Group #id". **Search** input `#contactSearch` "Search by name or phone" filters rows client side over a lowercase `data-search` of name plus formatted phone. **Table** (scrollable, max ~320px, sticky header): select-all checkbox (only affects currently visible rows), name (name, else first+last, else "Contact #id"), phone shown as `+<country_code> <mobile>` (dial code shown only if present; dash when no mobile). Empty: "No contacts yet. Add some" (link to `/contacts`). The selected counter counts ticked `contacts[]` only, not group/tag members. Hiding a row via search unticks it.
- **Endpoints:** none of its own.
- **Data:** POST `contacts[]` (ints), `groups[]` (ints), `tags[]` (ints).
- **Rules & edge cases:**
  1. Groups and tags are additive with individually ticked contacts; duplicates are merged server side (TW-BCAST-010).
  2. The preloaded list is capped at 500 contacts (TW-BCAST-004 rule 1).
  3. There is no manual phone-number entry on this form (the tags comment mentions manual numbers, but no such field exists).
  4. Opt-out status is not shown; opted-out contacts are dropped server side without warning (TW-BCAST-010).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 tags, When the page loads, Then each chip shows the number of distinct contacts carrying it.
  - Given the admin types "ravi", When rows filter, Then non-matching rows are hidden and unticked and the counter updates.
  - Given select-all is ticked while a search hides some rows, When toggled, Then only visible rows change.
  - Given the workspace has no contacts, When the page loads, Then the "No contacts yet" row with an "Add some" link is shown.
- **Source refs:** `resources/views/user/broadcasts/create.blade.php`, `resources/js/charts/user-broadcasts-create.js`.
- **Port notes:** Add server-side contact search/pagination and a segment picker; tags/groups come from CON. Show the resolved recipient count before sending (Reference does not).

### TW-BCAST-008 — Schedule selector: send now or later

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-BCAST-004
- **Summary:** Two radio cards choose immediate sending or a future date, time and timezone.
- **Actors & access:** Owner/admin composing (not shown for Instagram, which always sends immediately).
- **UX & screens:** Heading "When do you want to send your broadcast?"; cards "Send now" (default, "Send after final validation.") and "Schedule for later" ("Choose a specific day and time."); the active card is highlighted and the preview aside label switches between "Now" and "Later". Choosing Later reveals three fields: Send date (`type=date`, `min` = today in the default timezone, default today), Send time (`type=time`, default now+30 min) and Timezone select (default workspace timezone). The fields are only hidden with CSS, so they are submitted in both modes.
- **Endpoints:** none of its own.
- **Data:** POST `schedule_type` (`now`|`later`), `send_date` (Y-m-d), `send_time`, `timezone`.
- **Rules & edge cases:**
  1. Nothing on the client or the server rejects a past date/time (the `min` attribute is advisory). See TW-BCAST-015 for what the server does with it.
  2. `timezone` is posted even for "now" (workspace default) and is stored on the broadcast.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given "Schedule for later" is clicked, When the card toggles, Then the date/time/timezone fields appear and the label shows "Later".
  - Given "Send now" is selected, When the form submits, Then `schedule_type=now` is posted along with the (hidden) timezone.
  - Given the default state, When the page loads, Then "Send now" is selected and the label reads "Now".
- **Source refs:** `resources/views/user/broadcasts/create.blade.php`, `resources/js/charts/user-broadcasts-create.js` (applyScheduleMode).
- **Port notes:** Validate that the scheduled instant is in the future server-side (Reference does not).

### TW-BCAST-009 — Store request: authorization, plan gates and validation

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** -
- **Summary:** `POST /broadcasts` is the single entry that creates broadcasts (also called internally by the REST API). It checks the role, the plan feature and limit, then validates the form.
- **Actors & access:** Owner/admin (`workspace.role:admin`). Plan feature key `broadcast` (`packages.broadcast`, default off); numeric limit key `broadcast_limit` (`packages.broadcast_limit`, default 0 = unlimited). Workspace owners with platform "Super Admin"/"Admin" role bypass both. Effective values honor per-workspace `plan_overrides`.
- **UX & screens:** Submit button "Add Broadcast". On any failure the page redirects back with the old input and either `error` flash (single string) or validation errors (first message shown). On success redirect to `/broadcasts` with a `status` flash (TW-BCAST-015).
- **Endpoints:**

| Method uri      | Route name            | Controller@action          | Middleware                              | Request fields | Response                                                                                                                                                     |
| --------------- | --------------------- | -------------------------- | --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST broadcasts | user.broadcasts.store | BroadcastsController@store | Authenticate, EnsureWorkspaceRole:admin | see rules      | redirect to `user.broadcasts.index` with flash `status`; on JSON callers `{ok, broadcast_id, broadcast_ids[], devices_count}`; failures redirect back (form) |

- **Data:** counts `broadcasts` rows of the workspace for the limit.
- **Rules & edge cases:**
  1. Order of checks: `PlanLimitGuard::feature(workspace, 'broadcast')` then `PlanLimitGuard::check(workspace, 'broadcast_limit', count of broadcasts where workspace_id = current)`; both throw `PlanLimitReachedException` (rendered as back-with-error for forms, HTTP 422 JSON otherwise); then request validation.
  2. The limit uses a live row count with `>=`: it triggers when count already equals the limit, so a fan-out can exceed the cap by (senders - 1), and deleting a broadcast frees a slot (unlike the increment-only quota ledger used for campaigns). Each device slice is its own row and consumes one unit of the limit.
  3. Validation rules: `broadcast_name` required string max 255; `template_id` nullable integer exists in `wa_templates.id`; `template_overrides` nullable string max 65000; `contacts` nullable array of integers each existing in `contacts.id`; `groups` nullable array of integers existing in `contact_groups.id`; `tags` nullable array of integers; `device_id` nullable (bare id, legacy); `device_ids` nullable array of strings max 64; `device_share` nullable array, each value nullable numeric between 0 and 1000; `schedule_type` required, `now` or `later`; `send_date` required when later, format `Y-m-d`; `send_time` required when later (no format rule); `timezone` nullable string max 64.
  4. `exists:` checks are global (not workspace scoped); ownership is enforced afterwards by scoping every lookup to the current workspace (TW-BCAST-010, -012). A foreign or unknown id is silently dropped, or for the template rejected with "Selected template was not found in your workspace."
  5. `channel=instagram` diverts to TW-BCAST-019 before the limit check (Instagram checks only the `broadcast` feature, not `broadcast_limit`, and creates no broadcast row).
  6. QUIRK: `template_id` is optional on the server although the form makes it required. A broadcast with no template and no message body is created and then every recipient fails at send (Node: "No template or message body provided"/"Failed to send"; SMS runner: "Empty phone or message"). A rebuild should require a template (or a body) for WhatsApp.
  7. `send_time` is not format validated; an unparsable value makes `Carbon::parse` throw (HTTP 500 in Reference).
  8. Sender keys: each `device_ids[]`/`device_id` value is resolved via `WorkspaceEngine::senderForKey(workspaceId, key)` against the senders usable right now; unresolvable keys (forged, stale, disabled engine) are silently dropped; results are de-duplicated by key. A bare integer key is resolved against the workspace default engine.
- **Async & events:** none at this step (see TW-BCAST-015/016).
- **External systems:** none.
- **Settings:** `packages.broadcast`, `packages.broadcast_limit`, workspace `plan_overrides`.
- **Acceptance criteria:**
  - Given a plan with `broadcast` off, When an admin POSTs, Then the request is refused with the plan-feature-disabled message and nothing is created.
  - Given `broadcast_limit=5` and 5 existing broadcasts in the workspace, When the admin submits, Then it is refused with a limit-reached message; after deleting one it succeeds.
  - Given `schedule_type=later` without `send_date`, When submitted, Then a validation error on `send_date` is shown and the form keeps its old values.
  - Given `template_id` of another workspace's template, When submitted, Then the redirect shows "Selected template was not found in your workspace."
  - Given a name longer than 255 chars, When submitted, Then validation fails.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (store), `app/Services/PlanLimitGuard.php`, `app/Http/Middleware/EnsureWorkspaceRole.php`, `app/Models/Package.php`, `config/plan_gates.php`.
- **Port notes:** Implement as NestJS `POST /broadcasts` with a Zod/class-validator DTO in `packages/contracts`; plan checks via the PLAN entitlement service. Use a count of live rows (or a ledger, product decision) for the limit.

### TW-BCAST-010 — Audience resolution, workspace scoping and opt-out removal

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-009
- **Summary:** Turns the ticked contacts, groups and tags into one de-duplicated list of contact ids, guaranteed to belong to the caller's workspace and to exclude contacts who opted out.
- **Actors & access:** System step inside store.
- **UX & screens:** Failure copy: "Select at least one contact or group (opted-out contacts are skipped automatically)." shown as the red banner on the composer (redirect back with old input).
- **Endpoints:** part of `POST broadcasts`.
- **Data:** reads `contacts` (id, contact_group, is_unsubscribed, workspace_id), `tags`, `contact_tag`.
- **Rules & edge cases:**
  1. Direct contacts: submitted ids are intersected with contacts of the current workspace (foreign ids dropped).
  2. Groups: all workspace contacts are loaded and filtered in PHP because `contact_group` is an encrypted JSON array of group ids; a contact matches when any of its group ids (compared as strings) is in the submitted set. Cost is O(all workspace contacts) per submit (port: SQL join table).
  3. Tags: submitted tag ids are first restricted to tags of the workspace, then all workspace contacts having any of those tags are added.
  4. The three sources are merged and de-duplicated by contact id (order: direct, group members, tag members).
  5. Opt-out: any contact with `is_unsubscribed = true` (STOP keyword or manual unsubscribe) is removed before anything else happens.
  6. If the resulting set is empty the request fails with the message above.
  7. Not done: no de-dupe by phone number (two contact records with the same phone both get a message), no phone-validity check (contacts with an empty phone stay in the audience and are only dropped at dispatch, TW-BCAST-016 rule 6), no recipients-per-broadcast cap (TW-BCAST-041), no per-workspace daily cap.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given contact 5 is ticked and also belongs to a selected group, When the audience resolves, Then it is attached once.
  - Given a selected tag whose id belongs to another workspace, When resolving, Then that tag contributes nothing.
  - Given every selected contact has `is_unsubscribed=true`, When submitted, Then the request fails with the "Select at least one contact or group" message and no broadcast is created.
  - Given a forged contact id from another workspace exists globally, When submitted, Then it is silently dropped and the broadcast is created with the remaining ids.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (store, lines resolving contacts/groups/tags/opt-out), `app/Models/Contact.php`.
- **Port notes:** Contacts and group membership live in CON; expose an `AudienceResolver` service that takes `{contactIds, groupIds, tagIds}` and returns ids scoped by RLS, used by broadcasts, campaigns and scheduled messages alike. Preserve the opt-out exclusion (consent).

### TW-BCAST-011 — Wallet precheck before a blast (and what the SendGate does not do)

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-BCAST-009
- **Summary:** Before creating anything, the store step asks the billing layer whether the workspace's wallet can cover the blast. If the wallet is empty for a wallet-billed workspace the whole broadcast is refused.
- **Actors & access:** System step. Applies to all WhatsApp engines and (unnecessarily) to SMS.
- **UX & screens:** Redirect back with the old input and the exception message as the red error banner (typically "Your message wallet is empty. Top up to start sending.", or a reason from the billing precheck).
- **Endpoints:** part of `POST broadcasts`.
- **Data:** none written here.
- **Rules & edge cases:**
  1. Calls `SendGate::screenBody('', {source: 'broadcast', workspace_id, count = audience size})`; that runs `MessageBillingService::precheck(workspace, count)` and audits `billing.send_blocked_no_wallet` when it blocks. It is a no-op for plan-quota and meta_direct workspaces (precheck returns ok). Any thrown error is caught and shown; a broken check fails open.
  2. QUIRK: the body passed is an empty string, so the content guardrails (link count, scam pattern, finance phrases; admin `/admin/security` guardrail mode off/monitor/enforce) never see the real message. Also `screenBody` does not call the emergency send halt (`platform.emergency_send_halt`), so a platform-wide halt does not stop broadcast creation at this step (other paths call `SendGate::guard()`). A rebuild should run the guardrails on the resolved template/body text and honor the halt.
  3. The check happens before the warmer reservation and before any row is created, so a block leaves no residue.
  4. Billing itself happens later, at delivery time, per message id (TW-BCAST-025 and the `wallet-message-billing` domain).
- **Async & events:** audit-log row `billing.send_blocked_no_wallet` on block.
- **External systems:** none.
- **Settings:** `security.wa_guardrails_mode` (off/monitor/enforce, default off), `platform.emergency_send_halt`, `wallet_billing_on_delivery` and pay-per-message flags (WALLET).
- **Acceptance criteria:**
  - Given a pay-per-message workspace with a zero wallet, When it submits a 100-recipient broadcast, Then it is refused with the wallet message and no broadcast/recipient row exists.
  - Given a plan-quota workspace with a zero wallet, When it submits, Then it proceeds.
  - Given the emergency halt is engaged, When a broadcast is submitted, Then (Reference behavior) creation still proceeds; the port should refuse it.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (store), `app/Support/SendGate.php`, `app/Services/MessageBillingService.php`.
- **Port notes:** Call the WALLET precheck service; add the halt and guardrail checks the original skipped. Emit the audit event via the audit/outbox pattern.

### TW-BCAST-012 — Template pre-flight guards (auth block, media reachability, WABA quality)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-009
- **Summary:** Before spending sending allowance, the server checks the chosen template and refuses the broadcast with a clear reason when it is bound to fail or to hurt the WABA quality rating.
- **Actors & access:** System step inside store (only when a `template_id` was posted).
- **UX & screens:** Redirect back with old input and a red banner. Messages (paraphrased, keep the first phrase): "Selected template was not found in your workspace." / "Authentication (OTP) templates cannot be broadcast, each recipient needs a unique verifiable code; send them 1:1 from your backend via the transactional template send endpoint." / "Cannot broadcast this template: <reason(s)>".
- **Endpoints:** part of `POST broadcasts`.
- **Data:** reads `wa_templates` (workspace scoped), `system_settings.waba_templates_v2_enabled`.
- **Rules & edge cases:**
  1. Workspace scoping: the template is looked up with `forCurrentWorkspace()`; a foreign or missing id is rejected (validation only proved global existence).
  2. Authentication templates (`template_type = auth`) are always refused for broadcasts, on every engine. Node repeats the check (defence in depth, TW-BCAST-022).
  3. Media header reachability runs for **all engines** whenever the template has an attachment type other than none/text/location AND an attachment file: `media_url(file)` must be `https`, host must be a public DNS name or a public IP (private/reserved IP literals are rejected; hosts ending `.local`, `.test`, `.internal`, `.localhost`, and `localhost` are rejected) or the message names the offending condition ("Media URL must be HTTPS ... configure APP_URL with an https:// public domain"). Only scheme and host shape are checked; the file is not fetched. A refusal is logged as `[BCAST] refused`.
  4. WABA quality guards run only when the template has a `meta_template_id` AND the admin flag `waba_templates_v2_enabled` is on, regardless of which engine the operator picked (docs say "Business API only"; the code is template-based). Reasons collected and joined: Meta status is not APPROVED (case-insensitive); `paused_until` is in the future (message includes the resume time `Y-m-d H:i`); quality score is RED (UNKNOWN, YELLOW and GREEN pass, because unrated approved templates such as hello_world must still send). Locally approved templates without a `meta_template_id` skip these guards.
  5. Guards are evaluated once at creation; a scheduled broadcast is not re-checked at fire time.
- **Async & events:** warning log lines only.
- **External systems:** none (Meta status is read from the stored template row, kept fresh by TPL/WABA sync).
- **Settings:** `waba_templates_v2_enabled` (default off).
- **Acceptance criteria:**
  - Given an authentication template, When submitted, Then the OTP refusal message is shown and nothing is created.
  - Given a template with an IMAGE header served over `http://`, When submitted on any engine, Then the request is refused mentioning HTTPS.
  - Given the v2 flag is on and a Meta template with quality RED, When submitted, Then it is refused with the RED reason; with quality UNKNOWN it proceeds.
  - Given a template paused until tomorrow, When submitted, Then the reason includes the pause end time.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (store, mediaUrlReachableForMeta), `app/Models/WaTemplate.php`.
- **Port notes:** Implement as a `TemplateSendability` policy shared with campaigns/scheduled/1:1 sends (Reference duplicates it in TemplateSender). Consider also re-checking at fire time.

### TW-BCAST-013 — WhatsApp Warmer hold and budget reservation

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-BCAST-010
- **Summary:** Numbers that are still "warming up" (ramped daily budget and active hours) cannot be blasted beyond their allowance. A broadcast that would exceed a warming sender's budget, or that is sent outside its active hours, is held (refused) with an explanation; a passing broadcast reserves its volume against the warmer ledger.
- **Actors & access:** System step. The warmer itself is configured at `/warmer` (domain `scheduled-queue-warmer`).
- **UX & screens:** Redirect back with a red banner "Held by WhatsApp Warmer: <reasons joined> You can adjust these limits at /warmer." Reason variants: "<label> is warming and outside its active hours right now."; "<label> is warming, its today|<date> warm-up budget is already used up."; "<label> is warming, only R of its B-message budget for <when> remains, but this send has N recipients. Reduce the audience or try again tomorrow as the budget ramps up." (immediate) / "...Reduce the audience or pick a later date." (scheduled). `<label>` is the sender label, else "Device #id".
- **Endpoints:** part of `POST broadcasts`.
- **Data:** reads/writes the warmer ledger via `WarmerService` (`enabled`, `withinActiveHours`, `remainingFor`, `dailyBudgetFor`, `recordSendsFor`) on the sender's row (`devices` for Baileys, `wa_provider_configs` for waba/twilio/sms).
- **Rules & edge cases:**
  1. Evaluated per sender slice after the audience split (TW-BCAST-014), only for senders that have a non-empty slice and whose warmer is enabled.
  2. Active-hours check applies to immediate sends only; scheduled sends check the budget of the send date (`scheduled_at` date, app timezone) instead of today.
  3. A slice larger than the remaining budget is blocked entirely (one Node batch cannot be split), so the operator must reduce the audience or choose another date.
  4. Any hold blocks the whole submission (all slices), nothing is created.
  5. When all slices pass, each slice reserves its recipient count (`recordSendsFor(device, n, date)`) **before** the rows are created. The reservation is not released if the later transaction fails, if the broadcast is deleted, or if sends fail (QUIRK: budget can leak).
  6. At dispatch the warmer's per-number send gap `{min,max}` seconds is added to the Node payload (`warmerGap`) for warming senders (TW-BCAST-016/022).
- **Async & events:** warmer ledger writes.
- **External systems:** none.
- **Settings:** warmer config per number (enabled, active hours, ramp, `gap_min`, `gap_max`), admin defaults (SCHED domain).
- **Acceptance criteria:**
  - Given a warming number with 20 messages left today, When an immediate 50-recipient broadcast is submitted on it, Then it is held with the "only 20 ... remains" message and nothing is created.
  - Given a warming number outside its active hours, When an immediate broadcast is submitted, Then it is held with the active-hours message; a scheduled broadcast for tomorrow is checked against tomorrow's budget instead.
  - Given the warmer is disabled on the number, When submitted, Then no reservation and no `warmerGap` are applied.
  - Given the broadcast passes, When rows are created, Then the ledger for the send date increases by the slice size.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (store warmer block, dispatchToBridge warmerGap), `app/Services/WarmerService.php`, `node/utils/sendSafety.js` (getJitteredMessageDelay override).
- **Port notes:** Reservation should be transactional with broadcast creation and released on delete/failure (fix the leak). Warmer ledger belongs to SCHED; expose a `reserve(senderId, n, date)` API.

### TW-BCAST-014 — Multi-device audience split and per-sender fan-out

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-010, TW-BCAST-006
- **Summary:** With more than one sender ticked, the audience is divided between them proportionally to their share weights, each contact going to exactly one sender, and one broadcast row is created per sender.
- **Actors & access:** System step inside store.
- **UX & screens:** Success flash for a fan-out: "N broadcasts sent|scheduled across M devices." Each broadcast is named "<name> · <sender label or Device #id>" (suffix only when more than one sender).
- **Endpoints:** part of `POST broadcasts`.
- **Data:** creates N `broadcasts` rows (see TW-BCAST-015).
- **Rules & edge cases:**
  1. Slices: the resolved senders (de-duplicated by composite key); zero senders yields a single device-less slice.
  2. Weights: read from `device_share[key]` (fallback to the bare id key); non-numeric or non-positive values become 1 (QUIRK: a weight of 0, which the UI allows, does NOT exclude the sender; it counts as 1). If the total weight is somehow <= 0, equal weights are used.
  3. Bucket sizes: for each slice compute `exact = weight / sumWeight * total`, take the floor, then hand the remainder (total minus the sum of floors) one unit at a time to the slices with the largest fractional parts (descending fraction, `arsort`; ties in index order). The sizes always add up exactly to the audience and stay within 1 of the ideal.
  4. Contacts are cut into consecutive slices of the merged id list in that size order (no shuffling), so each contact is in exactly one bucket and no duplicate is ever created.
  5. A sender whose bucket is empty (for example 1 contact and 2 senders) is skipped when there are 2+ senders; with exactly one slice an empty bucket cannot occur because the audience is non-empty.
  6. The same `template_overrides`, template, name (plus suffix), timezone and schedule apply to every slice.
  7. The whole set is created inside one database transaction.
  8. Every slice consumes one unit of the `broadcast_limit` plan cap (checked before creation with the current count only).
- **Async & events:** log line `[BCAST] store() audience split computed` with weights and bucket sizes.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 10 contacts and weights 7/3, When submitted, Then two broadcasts are created with 7 and 3 recipients respectively.
  - Given 10 contacts and 3 equal weights, When submitted, Then sizes are 4/3/3 (remainder goes to the first largest fractions) and every contact appears once.
  - Given 1 contact and 2 senders, When submitted, Then exactly one broadcast is created and the empty slice is skipped.
  - Given weights 5 and 0, When submitted, Then the 0-weight sender is treated as weight 1 (documented Reference behavior).
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (store: weights, sizes, buckets, transaction).
- **Port notes:** Pure function, unit-test it (largest-remainder apportionment). Decide whether weight 0 should mean skip (recommended).

### TW-BCAST-015 — Persisting broadcasts and recipient rows; schedule instant

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-014
- **Summary:** Writes one `broadcasts` row per slice and one `broadcast_contacts` row per recipient, then dispatches each slice. Reports success to the operator and returns to the list.
- **Actors & access:** System step inside store.
- **UX & screens:** Redirect to `/broadcasts` with flash `status` = `Broadcast "<name>" sent.` (immediate) or `... scheduled.`; fan-out variant in TW-BCAST-014. JSON callers get `{ok, broadcast_id (first), broadcast_ids, devices_count}`.
- **Endpoints:** part of `POST broadcasts`.
- **Data:** `broadcasts` insert: `user_id` (creator), `workspace_id`, `provider` (the chosen sender's engine; device-less slice falls back to the workspace default engine; the model also auto-stamps when empty), `device_id` (sender id in the engine's own table: `devices.id` for baileys, `wa_provider_configs.id` for waba/twilio/sms), `template_id`, `template_overrides` (sanitized, encrypted array or null), `name` (encrypted), `timezone` (encrypted, default `UTC` when not posted), `status` (`processing` for now, `scheduled` for later), `scheduled_at`, `total_recipients` = slice size. `broadcast_contacts` insert per recipient with `status=pending`, created_at/updated_at.
- **Rules & edge cases:**
  1. Schedule instant: for "now", `scheduled_at = now()`; for "later", `scheduled_at = Carbon::parse(send_date + ' ' + send_time)` interpreted in the **application timezone** (`APP_TIMEZONE`, default UTC), NOT in the chosen `timezone`. The timezone value is only stored and forwarded to Node. QUIRK/likely bug: with the default app timezone and a selected `Asia/Kolkata` at 09:00, the instant is 09:00 UTC (14:30 IST). The docs promise "exact time and time zone". A rebuild must interpret date/time in the chosen zone and store UTC. Verify live in parity testing.
  2. No check that the scheduled instant is in the future (TW-BCAST-008 rule 1). A past date makes Node's cron expression (minute hour day month, no year) wait for the next annual occurrence.
  3. `template_overrides` is passed through `TemplateOverrideResolver::sanitize` (TW-BCAST-017) which drops invalid parts and returns null when nothing valid remains.
  4. The recipients are attached even if they have no usable phone; they stay `pending` forever if dropped at dispatch (TW-BCAST-016 rule 6).
  5. The flash says "sent" as soon as the rows exist and the dispatch call returned, even if dispatch marked the row `failed` (bridge down, no sender, no phone). The operator only learns of failure from the list badge (QUIRK).
  6. Model events: `created` fires the outbound webhook `broadcast_created` and an in-app notification (TW-BCAST-029). Every subsequent `status` change fires `broadcast_status_updated`.
  7. Store runs dispatch synchronously in the web request for each slice in order (each Node call has a 15 s timeout).
- **Async & events:** `[BCAST]` info logs; webhook + notification events; then TW-BCAST-016.
- **External systems:** none directly.
- **Settings:** `APP_TIMEZONE`.
- **Acceptance criteria:**
  - Given a valid immediate submit for 5 contacts and one sender, When processed, Then one broadcast with status `processing`, total_recipients 5 and 5 `broadcast_contacts` rows with status `pending` exists, and the user lands on `/broadcasts` with a "sent" flash.
  - Given a scheduled submit, When processed, Then the row has status `scheduled`, the given timezone stored, and (port requirement) `scheduled_at` equals the wall time in that timezone converted to UTC.
  - Given two senders, When processed, Then two rows exist, created in the same transaction (both or neither).
  - Given the template overrides contain only blank values, When saved, Then `template_overrides` is null.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (store), `app/Models/Broadcast.php` (booted, casts), `database/migrations/2026_05_05_000006_create_broadcasts_table.php`, `..._add_device_id_to_broadcasts.php`.
- **Port notes:** Table `broadcasts` + `broadcast_recipients` (rename of broadcast_contacts) with composite FKs `(workspace_id, id)` and RLS; write an outbox event in the same transaction. Encrypt or not: names are plain in the port; decide with security. Store UTC and IANA zone separately.

### TW-BCAST-016 — Bridge dispatch to Node: sender resolution, payload, failure states

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-BCAST-015
- **Summary:** For each created broadcast, Laravel resolves the sending phone, hydrates the recipients and template, builds the JSON payload and calls the Node bridge to send now or to schedule. It also owns the failure states when a dispatch cannot start.
- **Actors & access:** System (store, retry, sweeper).
- **UX & screens:** none directly; visible as the broadcast status (`processing`/`scheduled`/`failed`).
- **Endpoints:** outbound `POST {node}/api/broadcast/send-immediate/{senderDigits}` or `POST {node}/api/broadcast/schedule/{senderDigits}` (timeout 15 s). Node base URL = system setting `baileys_server_url`, else env `SERVER_URL`, trailing slash trimmed (`tw_node_url()`).
- **Data:** reads `devices`, `wa_provider_configs`, `contacts` (encrypted mobile/name/attributes), `wa_templates`; updates `broadcasts.status`, `node_schedule_id`.
- **Rules & edge cases:**
  1. Order: SMS provider is intercepted first and never touches Node (TW-BCAST-020). If the Node base URL is empty the method logs "aborted, SERVER_URL empty" and returns leaving the row at `processing`/`scheduled` forever (no failure status).
  2. Sender resolution for `waba`/`twilio`: the config row `wa_provider_configs.id = broadcasts.device_id`; if missing, the workspace's primary connected config of that same provider (order `is_primary` desc, id desc). The Node URL segment is the digits of that config's phone number (Node routes by `payload.provider` and only uses the phone to find the workspace credentials). No phone => status `failed`.
  3. Sender resolution for Baileys/untyped: `devices.id = device_id`; else the workspace's newest `connected` device; else (legacy) the creator's connected device with null workspace. None => status `failed`. Phone digits = digits of `country_code` + `phone_number`; empty => `failed`.
  4. Recipient hydration: the broadcast's attached contacts (or only `retryContactIds` on retry) with fields id, phone, name, first_name, last_name, email, title, middle_name, address, language, contact_group (joined by ", "), country_code (digits), mobile (digits), custom_attributes (array). `phone` = country code digits + local digits unless the local number already starts with the country code, else the local digits.
  5. `templateData` = `TemplateDataBuilder::build(template, workspace)`: id, template_name, template_type (default standard), category, language (default en_US), header, title_text (same as header), template_body, footer, buttons, location (header_location), attachment_type/file/url, `attachment_base64` + `attachment_mime` (media inlined once so Node never downloads per recipient), carousel_data, variable_map, twilio_content_sid. Workspace-level attributes are resolved once server-side inside header/body/footer/carousel text; contact-level placeholders stay literal for Node to substitute per recipient.
  6. Recipients whose assembled phone is empty are dropped from the payload but stay attached and `pending`; when none remain the broadcast is marked `failed`.
  7. Payload fields: `broadcastId`, `targetContacts[]`, `isTemplate` (a template was found), `templateData` (or null), `message` (= templateData.template_body or empty), `provider` (the row's engine), optional `tracked_bodies` (TW-BCAST-018), optional `templateData.meta_payloads` (TW-BCAST-017), optional `warmerGap {min,max}` when the sender is warming (TW-BCAST-013), and for scheduled sends `scheduleDateTime` (ISO 8601 with offset) and `timezone` (row timezone, default UTC).
  8. Response handling: 2xx => save `node_schedule_id` from `scheduleId` and set status `processing` (immediate) or `scheduled`; for immediate sends mirror into open inbox threads (TW-BCAST-028). Non-2xx (404, 503 "client not ready", others) or an exception/timeout => status `failed`, logged with a hint. There is no automatic retry of the dispatch itself; the sweeper (TW-BCAST-039) retries failed _recipients_, and a dispatch failure leaves recipients `pending` (never picked up).
  9. All dispatch failures are logged with `[BCAST]` prefixes; none is surfaced to the operator beyond the status badge (TW-BCAST-015 rule 5).
  10. The call is synchronous (blocks the HTTP request up to 15 s per slice). The port should enqueue a BullMQ job instead.
- **Async & events:** Node accepts the request and processes asynchronously (TW-BCAST-022). Model `updated` hook fires `broadcast_status_updated` on status changes.
- **External systems:** Node bridge (auth: Laravel to Node is allowed from loopback or with `X-Node-Token`; Laravel does not attach the token on these calls in the default same-host topology).
- **Settings:** `baileys_server_url` (admin setting) / `SERVER_URL` (.env), `node_webhook_token`/`NODE_WEBHOOK_TOKEN`, `waba_templates_v2_enabled`.
- **Acceptance criteria:**
  - Given a Baileys sender `+91 98765 43210` and 3 recipients, When an immediate broadcast is dispatched, Then Laravel POSTs to `/api/broadcast/send-immediate/919876543210` with 3 `targetContacts`, and on 2xx stores the returned `scheduleId` and status `processing`.
  - Given Node returns 503, When dispatching, Then the broadcast status becomes `failed`.
  - Given every recipient has an empty phone, When dispatching, Then the status becomes `failed` without calling Node.
  - Given a scheduled broadcast, When dispatched, Then the payload carries `scheduleDateTime` with an offset and `timezone`, and status `scheduled` is saved.
  - Given `SERVER_URL` is empty, When dispatching, Then no call is made and the row stays at its initial status.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (dispatchToBridge), `app/Services/Whatsapp/TemplateDataBuilder.php`, `app/Support/fc_helpers.php` (tw_node_url, node_token), `app/Models/WaProviderConfig.php`, `app/Models/Device.php`, `node/controllers/broadcastController.js`.
- **Port notes:** In the port the "bridge" is a BullMQ job that calls the Baileys/WABA/Twilio adapters; keep the payload logic (recipient hydration, templateData) but in a worker. Persist the schedule in Redis/Postgres, not memory (TW-BCAST-021).

### TW-BCAST-017 — Per-recipient WABA template payload pre-build (variables, overrides, OTP, buttons, carousel)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-BCAST-016
- **Summary:** For Meta-approved templates Laravel builds the full Meta `type:template` message per recipient (body variables, button parameters, media header, carousel cards, tracked links) and ships them to Node keyed by contact id; Node sends them verbatim. This is also where send-time overrides are applied.
- **Actors & access:** System (dispatch). `varsForRecipient` is public because the team inbox composer and the inbox mirror reuse it.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `broadcasts.template_overrides` (encrypted JSON array), `wa_templates.variable_map/buttons/carousel_data`.
- **Rules & edge cases:**
  1. Trigger: the template has `meta_template_id`, its `meta_status` is APPROVED, and (`waba_templates_v2_enabled` is on OR the template "needs prebuild": media header (attachment type IMAGE/VIDEO/DOCUMENT or any attachment file), any buttons, or a carousel). The comment explains that Node's fallback builder only supports text header/body parameters, so those shapes must always be prebuilt regardless of the feature flag. The condition does not look at the engine, so payloads are also built (and ignored) for Baileys/Twilio slices.
  2. Per recipient, `varsForRecipient(template, contactRow, workspaceId, overrides)` returns `{header, body[], buttons[], cards{}, header_media_url}` and `TemplatePayloadBuilder::buildSend` turns it into the Meta payload stored at `templateData.meta_payloads[contactId]`.
  3. Value lookup order for a mapped key: contact column, then the contact's custom attributes, then `TemplateOverrideResolver::lookup` (workspace attributes and system tokens; also normalizes names such as "Phone Number" to `phone`). Values that are arrays are flattened to a comma-joined string of scalars; unknown keys become an empty string rather than failing the send.
  4. Header text: single slot (first mapped entry). Body: positional list in variable-map order.
  5. Buttons: only sub-types with a send-time parameter are emitted (`WaTemplate::buttonSubType` maps aliases such as `call`/`call_phone`, `copy_text`/`copy_code`; null = no parameter). URL/code values have `{{n}}` (positional, translated through the variable map) and `{{name}}` tokens substituted per contact. A QUICK_REPLY with an empty resolved value is omitted entirely (Meta rejects an empty payload with error 132000; without it Meta uses the button text).
  6. Header media: when the template has an attachment (type not none/text) the public `media_url` is passed as `header_media_url` (Meta `link`).
  7. Carousel (`template_type = carousel`): per card, image URL (absolute or `media_url`; `header_format` video when the extension is mp4 else image), body variables from `variable_map.cards[i].body`, and card buttons with the same alias and quick-reply rules.
  8. Authentication templates: never overridable; the vars are a freshly generated random 6-digit code per recipient placed in both the body parameter and the OTP slot (unreachable in practice because auth templates are blocked for broadcasts, TW-BCAST-012).
  9. Send-time overrides (`template_overrides`, sanitized at store): shape `{header: {mode: text|media, text | media_url}, body: [string...], footer: [string...], buttons: [{index, sub_type: url|quick_reply|copy_code, value}]}`; header text truncated to 1024 chars, media URL must be http(s); body/footer slots are trimmed and cut to 1024; all-blank sections are dropped; buttons need an index and non-empty value, unknown sub_type becomes `url`. Applied last (`overrideResolver->apply`) and win over the template's variable map only for the slots that were filled in; blank slots fall back to the template-driven value.
  10. QUIRK: overrides are applied **only** in this WABA prebuild path and in the inbox-mirror text. Baileys and Twilio slices ignore `template_overrides` entirely (Node substitutes from `templateData` which carries no overrides). The UI presents the panel for all engines.
  11. Each URL button value (and card URL button) that is a valid URL is wrapped for click tracking per recipient (TW-BCAST-018).
- **Async & events:** log `[BCAST] meta_payloads pre-built` with recipient count and trigger reason (first place to look for Meta error 132012 header-format mismatch).
- **External systems:** Meta Cloud API receives the payload via Node (TW-BCAST-023).
- **Settings:** `waba_templates_v2_enabled`.
- **Acceptance criteria:**
  - Given an approved Meta template `Hi {{1}}` mapped to `first_name`, When dispatching to 2 contacts, Then `meta_payloads` has one payload per contact id with the right first names.
  - Given a template with an IMAGE header and flag off, When dispatching, Then payloads are still prebuilt with the header media link.
  - Given an override body slot `["VIP"]`, When dispatching a WABA slice, Then that slot's value is "VIP" for every recipient; on a Baileys slice the override is ignored.
  - Given a contact custom attribute that is an array, When resolving, Then it becomes a comma-joined string and the send does not crash.
  - Given a QUICK_REPLY button with no payload value, When building, Then no parameter is emitted for that button.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (varsForRecipient, wrapUrlsForRecipient, dispatchToBridge), `app/Services/TemplateOverrideResolver.php`, `app/Services/Waba/TemplatePayloadBuilder.php`, `app/Models/WaTemplate.php`, `node/services/broadcastService.js` (buildWabaPayload fast path).
- **Port notes:** Belongs with the WABA/TPL template-send library; broadcasts call it. Apply overrides on every engine in the port (fix the quirk) or hide the panel for non-WABA engines.

### TW-BCAST-018 — Link-click tracking: wrapping, redirect endpoint and counters

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-BCAST-016
- **Summary:** URLs in a broadcast are replaced by a unique short link per recipient (`/r/{token}`). When a person taps it the click is attributed to that contact, the broadcast's `clicked_count` moves, and the visitor is redirected to the real URL.
- **Actors & access:** Wrapping is system-side. The redirect endpoint is public (no auth, no middleware). Tracking can be switched off platform-wide.
- **UX & screens:** Consumer screens: list column "Clicked" (TW-BCAST-001), recipients tab column "Clicks" with last-click tooltip (TW-BCAST-032), CSV columns (TW-BCAST-037). No standalone screen.
- **Endpoints:**

| Method uri    | Route name    | Controller@action         | Middleware | Request    | Response                                                        |
| ------------- | ------------- | ------------------------- | ---------- | ---------- | --------------------------------------------------------------- |
| GET r/{token} | link.redirect | LinkRedirectController@go | (none)     | path token | 302 to `original_url`; 404 "Link not found"; 410 "Link expired" |

- **Data:** `wa_link_clicks` (see Data model) rows keyed by unique `token`; `broadcasts.clicked_count`.
- **Rules & edge cases:**
  1. Where links are wrapped for broadcasts: (a) WABA prebuilt payloads, every `url` sub-type button (and carousel card URL button) whose resolved value passes `FILTER_VALIDATE_URL`; (b) Baileys/Twilio text bodies: only when the shared template body contains `http` and tracking is on, Laravel ships `tracked_bodies` as a map contactId => body with every `http(s)://...` occurrence replaced by that recipient's own short link (`LinkTracker::wrapInText`; per-recipient failures are logged and that recipient gets the untracked body). Node prefers `tracked_bodies[contact.id]` over the shared body and still runs its own placeholder substitution over it. Freeform bodies without a template are not shipped a tracked map (only template bodies are wrapped).
  2. `LinkTracker::wrap(url, ctx)` returns the input unchanged when tracking is disabled, the URL scheme is not http/https, or it already starts with this app's `/r/` base. Otherwise it reuses an existing unexpired token when `original_url` and all four of `broadcast_id`, `campaign_id`, `message_id`, `contact_id` match exactly (nulls must match nulls), so retries never mint new links and never mix counters across campaigns; else it creates a row with a 12-character random base62 token (4 collision retries, then 20 chars), `expires_at = now + max(7, ttl days)` (ttl setting default 90) and the context (workspace, broadcast, campaign, message, contact, template ids, phone).
  3. Redirect handler: unknown token => 404; expired => 410; bot user agents (substrings: whatsapp, facebook, meta-externalfetcher, twitterbot, linkedinbot, slackbot, googlebot, bingbot, discordbot, embedly, curl/, wget/, python-requests) are redirected but not counted. For real visitors: `clicks + 1` (atomic SQL), `unique_clicks + 1` when the IP was not seen for this link in the last hour (cache key `link_click_ip:{id}:{ip}`, TTL 1 h), set `first_click_at` once, `last_click_at`, `last_ip` (45 chars), `last_user_agent` (191 chars). Then, if the row has a broadcast and a contact AND this hit was an IP-unique hit AND no earlier (lower id) `wa_link_clicks` row for the same broadcast+contact already has clicks > 0, `broadcasts.clicked_count += 1` (so the counter approximates "unique contacts who clicked"). A parallel branch increments campaign counters (owned by CAMP). Then it fires the outbound webhook `campaign_contact_clicked` (only when the row has a workspace) with broadcast/campaign/message/contact/template ids, phone, original_url, token, ip, ua. Finally 302 to `original_url`.
  4. Approximations to keep in mind: `unique_clicks` on a link only counts distinct IPs per rolling hour (cache based, not a distinct-IP table); `broadcasts.clicked_count` counts contacts, not clicks, and a second link tapped by the same contact does not add to it (the "earlier row already clicked" check compares row ids). A click whose first tap came from a bot is not counted at all.
- **Async & events:** outbound webhook `campaign_contact_clicked` (name reused for broadcasts).
- **External systems:** none.
- **Settings:** `waba_link_tracking_enabled` (system setting, default true), `wa_link_tracking_ttl_days` (default 90, minimum enforced 7).
- **Acceptance criteria:**
  - Given a Baileys broadcast whose template body contains `https://shop.example/p/1`, When dispatched to 2 contacts, Then each contact's body carries a different `/r/<token>` and two `wa_link_clicks` rows exist with broadcast_id and contact_id set.
  - Given a recipient taps their link with a normal browser, When the redirect runs, Then they get a 302 to the original URL, `clicks=1`, the broadcast `clicked_count` becomes 1 and a `campaign_contact_clicked` webhook is dispatched.
  - Given the WhatsApp link-preview crawler user agent hits the link, When the redirect runs, Then the redirect is served but no counter changes.
  - Given the token's `expires_at` is in the past, When visited, Then HTTP 410.
  - Given tracking is disabled, When dispatching, Then original URLs are sent unchanged.
- **Source refs:** `app/Services/Waba/LinkTracker.php`, `app/Http/Controllers/LinkRedirectController.php`, `app/Models/WaLinkClick.php`, `app/Http/Controllers/BroadcastsController.php` (wrapUrlsForRecipient, tracked_bodies), `database/migrations/2026_05_24_050000_add_broadcast_tracking_and_link_clicks.php`, `routes/web.php` (line 327), `node/services/broadcastService.js` (trackedBodyFor), `Documentation/pages/messaging/broadcasts.html`.
- **Port notes:** Public redirect route on the API with rate limiting; store clicks with RLS by workspace (public lookup by token must bypass RLS through a security-definer function or a dedicated lookup role). Shared with campaigns.

### TW-BCAST-019 — Instagram reply-only broadcast

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-BCAST-004
- **Summary:** With `?channel=instagram` the composer sends a plain DM to selected existing Instagram conversations through the Instaflow bridge. It is synchronous, has no schedule, creates no broadcast row and does not appear in the list.
- **Actors & access:** Owner/admin; plan feature `broadcast` only (no `broadcast_limit`, no wallet or warmer checks).
- **UX & screens:** Composer variant (`create.blade.php`): "Send from" IG account select (options `@handle`; empty option "No Instagram account connected"), Message section with a "Write text" / "Use template" toggle (template picker of IG templates prefills the textarea, editable), textarea `message` (required, maxlength 1000, placeholder "Hi {name}! …", help "Instagram sends a plain DM, no approval needed. Use {name} to personalise."), heading "Which Instagram chats?", search by name, table of chats (name, "Instagram DM") filtered by the chosen account, no tags/groups, no schedule section, preview labelled "Message preview" with `{name}` shown as "there". Result flash on success: "Instagram broadcast sent, N delivered[, M failed]." (flash key `success`).
- **Endpoints:** same `POST broadcasts` with hidden `channel=instagram`.
- **Data:** POST `broadcast_name` (required, max 255), `message` (required, max 1000), `recipients[]` (required, min 1 integer conversation ids), `template_id` (nullable int, only a client-side prefill), `ig_account_id` (nullable string max 191). Writes `inbox_messages` (per delivered recipient: direction out, provider instagram, body, status sent, user_id, sent_at and delivered_at = now) and updates the conversation (`last_message_at`, `last_outbound_at`, `preview` = first 140 chars).
- **Rules & edge cases:**
  1. Requires the Instaflow client to be configured (`InstaflowClient::fromSettings()->isConfigured()`), else back with "Instagram is not connected."
  2. Recipient ids are de-duplicated; each must be a conversation of this workspace with channel `instagram`; the IG conversation id is `raw_jid` with a leading `ig:` removed; unknown/invalid ones count as failed.
  3. `{name}` in the message is replaced with the conversation title or "there"; no other variable is supported.
  4. Each recipient is sent via `client->reply(igConvId, 'text', text, ...)`; an exception counts as failed. The 24-hour messaging window is enforced by Instagram at send time (not pre-checked).
  5. If zero recipients succeeded: back with "Could not send to any recipient. Check the Instagram connection." Otherwise redirect to `/broadcasts` with the success flash.
  6. QUIRK: the loop is synchronous in the request (large selections risk timeouts); no `broadcasts` row is created, so IG sends have no history, stats, retry or list entry; mirror into the inbox is best-effort.
- **Async & events:** none (synchronous); inbox row creation.
- **External systems:** Instaflow bridge (Instagram DM reply API; credentials from admin settings).
- **Settings:** Instagram connection (channel-instagram domain).
- **Acceptance criteria:**
  - Given an IG account is connected and 3 chats are ticked, When submitted with message "Hi {name}!", Then 3 replies are sent, 3 inbox messages are created and the flash says "3 delivered".
  - Given the Instaflow client is not configured, When submitted, Then back with "Instagram is not connected."
  - Given one conversation id belongs to another workspace, When submitted, Then it counts as failed and the others are still sent.
  - Given `message` is 1001 chars, When submitted, Then validation fails.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (storeInstagram, create), `resources/views/user/broadcasts/create.blade.php`, `resources/js/charts/user-broadcasts-create.js`, `app/Services/Instaflow/InstaflowClient.php`.
- **Port notes:** Home in the IG channel module; broadcasts module only offers the entry. Rebuild as a queued job with a real broadcast row so history exists.

### TW-BCAST-020 — SMS broadcast runner (PHP transport)

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-BCAST-015
- **Summary:** A broadcast whose sender is an SMS number (Twilio SMS or MSG91) is sent by PHP instead of Node, reusing the same audience, form and list. It runs synchronously inside the request.
- **Actors & access:** Owner/admin; needs `sms_enabled` and a connected SMS number (chooser card, TW-BCAST-003). Plan cap `sms_monthly_limit` applies.
- **UX & screens:** Same composer opened with `?channel=sms`: senders limited to SMS numbers, the rest of the form unchanged (template select still required in the UI; there is no free-text SMS box, so the runner's `temp_caption` fallback is reachable only from the mobile queue). Results show on the normal list/detail (provider chip shows a dash for sms).
- **Endpoints:** part of `POST broadcasts`; runner is invoked from `dispatchToBridge` (also on retry and by the sweeper).
- **Data:** `broadcasts` (provider `sms`, `device_id` = `wa_provider_configs.id`), `broadcast_contacts`, `conversations`/`inbox_messages` (sms mirror).
- **Rules & edge cases:**
  1. `SmsBroadcastRunner::run(broadcast, retryContactIds)`: sender = SMS config of `device_id`, else the workspace's first SMS sender; none or not sendable => status `failed`, "No sendable SMS number connected".
  2. Plan quota: `PlanLimitGuard::check(workspace, 'sms_monthly_limit', outbound SMS this month)`; the count is inbox messages with provider sms and direction out for the workspace since the start of the month. Checked once before the run, so one blast can overshoot the cap. On breach status `failed`.
  3. Body: the template's `template_body` when a template is set, else `temp_caption`; `{{token}}` placeholders resolved with `TemplateOverrideResolver::lookup` (overrides are not applied). Recipients with no phone are removed; none => `failed`, "No recipients with a usable phone number". Each recipient with an empty phone or an empty body is marked failed ("Empty phone or message").
  4. Each send goes through `SmsClient`; per recipient the pivot row is updated (`sent` with the provider message id as `whatsapp_message_id` and `sent_at`; or `failed` with the error). Segment counts and cost (segments x sender rate) are computed and only logged/returned, not persisted.
  5. Each sent message is mirrored into the unified inbox: the SMS conversation is `firstOrCreate`d (`raw_jid = sms:<digits>`, status pending, inbox_status open) and an outbound `inbox_messages` row is written (unlike the WhatsApp mirror it does create conversations).
  6. Final counters written directly: `success_count = sent`, `fail_count = failed`, `completed_at = now`; status `completed` / `completed_with_errors` / `failed`. Delivered/read come later from the SMS status webhook (channel-sms).
  7. SMS cost is never billed to the WhatsApp wallet, yet the store step's wallet precheck still applies to SMS broadcasts (TW-BCAST-011).
  8. QUIRK (bug): `dispatchToBridge` diverts to the SMS runner before looking at `$immediate`, so a **scheduled** SMS broadcast (status `scheduled`, future `scheduled_at`) is actually sent immediately and marked completed. There is no SMS scheduling.
  9. Warmer: SMS senders are looked up as provider configs and can be warmer-gated like WABA/Twilio.
- **Async & events:** synchronous; model `updated` webhook/notification on the final status.
- **External systems:** Twilio SMS or MSG91 via `SmsClient` (credentials per workspace config).
- **Settings:** `sms_enabled`, `packages.sms_monthly_limit`, sender `rate_per_segment`/currency.
- **Acceptance criteria:**
  - Given a connected Twilio SMS number and a template with body `Hi {{name}}`, When 3 contacts are broadcast immediately, Then 3 SMS are sent, 3 pivot rows become `sent`, the broadcast becomes `completed` with success_count 3.
  - Given the monthly SMS cap is reached, When a broadcast runs, Then it is `failed` and nothing is sent.
  - Given one recipient's send errors, When the run ends, Then the status is `completed_with_errors` and that recipient's error is recorded.
  - Given a scheduled SMS broadcast (port requirement), When created, Then it must wait for its time (Reference sends immediately).
- **Source refs:** `app/Services/Sms/SmsBroadcastRunner.php`, `app/Http/Controllers/BroadcastsController.php` (dispatchToBridge SMS branch, create channel filter), `resources/views/user/broadcasts/index.blade.php`.
- **Port notes:** SMS transport belongs to the SMS channel module; queue the run with a BullMQ delayed job so scheduling works.

### TW-BCAST-021 — Node broadcast scheduler endpoints and in-memory schedule store

- **Status:** partial
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-BCAST-016
- **Summary:** The Node bridge accepts a broadcast, either to send right away or to fire at a future time, keeps it in an in-memory list plus an in-memory cron job, and exposes pause / resume / cancel / list / status controls.
- **Actors & access:** Called by Laravel (store, destroy, REST API stop, mobile queue). All `/api/*` Node routes are guarded by an app-level gate: allowed with a correct `X-Node-Token` (constant-time compare) or from a loopback peer (`NODE_API_AUTH`, default `loopback`; `token` and `off` modes exist).
- **UX & screens:** none.
- **Endpoints:** Node bridge routes (not Laravel routes):

| Method uri                                             | Handler                | Called by Laravel?                          | Notes                                                   |
| ------------------------------------------------------ | ---------------------- | ------------------------------------------- | ------------------------------------------------------- |
| POST /api/broadcast/send-immediate/:phoneNumber        | sendBroadcastImmediate | yes (store, retry, sweeper)                 | queues then runs at once, replies immediately           |
| POST /api/broadcast/schedule/:phoneNumber              | scheduleBroadcast      | yes (store with schedule)                   | registers a cron job                                    |
| POST /api/broadcast/pause/:scheduleId                  | pauseBroadcast         | no                                          | marks paused, stops cron                                |
| POST /api/broadcast/resume/:scheduleId                 | resumeBroadcast        | no                                          | marks scheduled, restarts cron                          |
| DELETE /api/broadcast/cancel/:scheduleId               | cancelBroadcast        | yes (destroy, API stop)                     | stops cron, removes from list                           |
| DELETE /api/broadcast/cancel-by-broadcast/:broadcastId | cancelByBroadcastId    | yes, from the mobile queue controller (MOB) | removes every pending entry whose `broadcastId` matches |
| GET /api/broadcast/list/:phoneNumber                   | getBroadcasts          | no                                          | entries of type broadcast for that sender               |
| GET /api/broadcast/status/:scheduleId                  | getBroadcastStatus     | no                                          | one entry                                               |

- **Data:** in-memory arrays `app.locals.scheduledMessages` (entries `{id, broadcastId, senderPhoneNumber, provider, warmerGap, targetContacts, message, isTemplate, templateData, status, type='broadcast', createdAt, scheduleDateTime, timezone, sentMessages{wamid: {contactId, contactName, phoneNumber, sentAt}}, lastError, sentCount, failedCount, failedContacts, completedAt}`) and `app.locals.scheduledJobs[id]` (cron handles). `node_schedule_id` on the Laravel row references the Node id (`broadcast_immediate_<ms>_<rand>` / `broadcast_scheduled_<ms>_<rand>`).
- **Rules & edge cases:**
  1. Both accept `targetContacts` (objects with `phone`) or the legacy `targetPhoneNumbers` (list of strings); none => HTTP 400 "No contacts provided".
  2. `send-immediate` warns when the sender socket is not ready but still queues (each recipient then fails with context); replies `{success, message, scheduleId, recipientCount}` right away and runs the send loop asynchronously (TW-BCAST-022).
  3. `schedule` builds a 5-field cron expression from the minute, hour, day-of-month and month of `scheduleDateTime` in the given timezone (day-of-week `*`, no year) and registers it with node-cron using that timezone. Replies `{success, scheduleId, scheduledFor, recipientCount}`. The job is stopped and deleted after it runs.
  4. QUIRK / CRITICAL: nothing persists these entries. On Node restart every scheduled broadcast is lost while its Laravel row stays `scheduled` forever; `syncScheduledMessages` at boot restores only `/api/scheduled/active` (scheduled messages, not broadcasts). The BroadcastSweeper ignores `scheduled` rows. The port must persist schedules (BullMQ delayed jobs) and reconcile on boot.
  5. Entries of finished runs are never removed from the in-memory list (only cancel removes), so the list grows and holds contact data until restart; receipt matching (TW-BCAST-024) depends on it.
  6. Pause/resume/list/status exist but no Laravel UI or API calls them (dead surface for broadcasts). `cancel-by-broadcast` was added so re-dispatch of the same Laravel broadcast can clear orphan crons (duplicate-send bug); the web controller does not call it.
  7. A past scheduled time registers a cron that waits for the next matching calendar date (about a year).
- **Async & events:** node-cron timers; asynchronous send loop.
- **External systems:** Node process; `moment-timezone`, `node-cron`.
- **Settings:** `NODE_API_AUTH`, `NODE_WEBHOOK_TOKEN`, `APP_DOMAIN_NAME` (callback base URL), `SERVER_URL`.
- **Acceptance criteria:**
  - Given a schedule request for tomorrow 09:00 in `Asia/Kolkata`, When Node accepts it, Then it returns a `scheduleId` and `scheduledFor` and fires exactly once at that local time.
  - Given Node restarts before the fire time, When it boots, Then (Reference) the schedule is lost; the port must still fire it.
  - Given `DELETE /api/broadcast/cancel/<id>` for a pending schedule, When called, Then the cron stops and the entry is removed; a second call returns 404 "Broadcast schedule not found".
  - Given an empty `targetContacts`, When posted, Then HTTP 400.
- **Source refs:** `node/controllers/broadcastController.js`, `node/routes/index.js` (lines 121-132 and the auth gate), `node/index.js` (locals init, restore), `node/controllers/scheduleController.js` (syncScheduledMessages).
- **Port notes:** Replace with a BullMQ queue `broadcast-send` (delayed job per broadcast slice, job id = broadcast id for idempotency), pause/resume/cancel via job state, all state in Redis/Postgres. Workers live in `apps/worker`.

### TW-BCAST-022 — Node send loop: engine routing, pacing, batching, daily cap, socket-drop pause

- **Status:** partial
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-BCAST-021
- **Summary:** `executeBroadcastSchedule` sends the message to each recipient in turn using the right engine, with human-like jittered gaps, optional batch cooldowns, a Baileys daily cap and a graceful stop when the socket drops, then reports the outcome to Laravel.
- **Actors & access:** Node internal.
- **UX & screens:** none (visible via statuses).
- **Endpoints:** calls Laravel `POST api/update-message-status` per recipient (TW-BCAST-025), `POST api/update-broadcast-status` per phase (TW-BCAST-026), and `GET api/whatsapp-message-settings` (pacing) and the per-phone WhatsApp settings lookup.
- **Data:** in-memory schedule entry; pacing settings `messageSettings`.
- **Rules & edge cases:**
  1. Start: look the entry up (missing => log and return); refresh pacing from Laravel (`msg_gap` default 3 s, `enable_batches` 0/1, `batches_gap` = batch size default 50, `bw_msg_gap` = minutes between batches default 5); load the per-workspace sending credentials for the sender phone (`getWhatsAppSettings(phone, broadcast_id)`) so the correct tenant's WABA/Twilio credentials are used.
  2. Engine routing: the row's `provider` is authoritative. `baileys` => neither WABA nor Twilio; `waba` => use Meta only if the settings carry `use_facebook_api`, a phone id and an access token; `twilio` => only if the settings are Twilio settings; an absent/unknown provider falls back to the workspace-wide heuristic (WABA if configured, else Twilio if configured, else Baileys). Note: a `waba` row with incomplete settings silently drops to the Baileys path and then fails for lack of a socket.
  3. Auth-template guard: if `templateData` is an authentication template the run ends with status `failed` (pushed to Laravel with counts 0/0).
  4. Baileys daily cap (Baileys only, not WABA/Twilio): remaining = cap - today's count for this sender (UTC day key, in-memory tally, cap = `messageSettings.baileys_daily_cap` default 4000; QUIRK: the settings refresh does not fetch this key so the cap is always 4000 unless set elsewhere). If none remains the entry becomes `paused` with a "cap reached, resume after midnight" note and `paused` is pushed to Laravel. The count only rises by successful sends and resets by UTC date.
  5. Cancelled or paused entries and empty recipient lists end the run (empty => `failed`). Baileys requires a live socket `app.locals.clients[sender]`; missing => `failed`.
  6. Status `sending`, push `processing` (counts 0/0), then loop. If `enable_batches` is on and the recipient count exceeds the batch size, recipients are processed in batches of `batches_gap` with a jittered cooldown of `bw_msg_gap` minutes (+/- 20%) between batches; otherwise one sequential loop.
  7. Before every recipient (Baileys) a liveness gate checks the socket (registry flag, WebSocket readyState OPEN, authenticated user). If unusable: entry `paused` ("Baileys connection dropped mid-run. Resume after reconnect."), push `paused` with the counts so far, unwind without marking the remaining recipients failed. There is no resume mechanism in Reference for these.
  8. Per recipient: no phone => report `failed` "No phone number"; otherwise personalize (TW-BCAST-023), send, and on success increment counters, bump the Baileys daily tally, remember `sentMessages[wamid]` for receipts, report `sent` with the wamid and `sent_at`; on failure report `failed` with the error text; thrown errors are reported as failed with the message, except socket-drop errors which abort the loop. After each recipient sleep a fresh jittered gap: the warmer's `{min,max}` seconds picks a uniform random value in the range (min 1 s), otherwise `msg_gap` +/- 20%.
  9. End of run: status `failed` if every recipient failed, `completed_with_errors` if some did, else `completed`; push `{status, success_count = this run's sent, fail_count = this run's failed}`. A crash sets `failed`. The cron job (if any) is always stopped in `finally`.
  10. QUIRKS: (a) `paused` is not an accepted status on the Laravel callback (validation rejects it with 422), so a pause never reaches the database: the broadcast stays `processing` and its unsent recipients stay `pending` forever; the sweeper only retries `failed` recipients, so nothing resumes them. (b) The batched branch never sets a failure reason when neither a template nor a message exists ("Failed to send" is reported). (c) Recipient loops run strictly sequentially per broadcast; there is no cross-broadcast concurrency limit per sender.
- **Async & events:** callbacks to Laravel after every recipient; timers.
- **External systems:** Baileys socket, Meta Graph API (`sendMessageViaFacebookApi`), Twilio (`sendMessageViaTwilioApi`), Laravel callbacks (`X-Node-Token` header from env `NODE_WEBHOOK_TOKEN`).
- **Settings:** admin pacing (System Message settings): `msg_gap`, `enable_batches`, `batches_gap`, `bw_msg_gap`; `baileys_daily_cap` (Node-side default); warmer `gap_min`/`gap_max`; `APP_DOMAIN_NAME`.
- **Acceptance criteria:**
  - Given 3 recipients and `msg_gap` 3 s, When sent on Baileys, Then consecutive sends are roughly 2.4-3.6 s apart and each success posts `sent` to Laravel before the next send.
  - Given `enable_batches=1`, batch size 50, gap 5 min and 120 recipients, When sent, Then three batches run with a jittered 4-6 minute pause between them.
  - Given the daily cap is 4000 and 4000 were sent today, When a broadcast starts, Then it stops with a paused note and no message is sent.
  - Given the socket drops after 10 of 100, When the next recipient is due, Then the loop stops, the remaining 90 stay `pending`, and (port requirement) a resume path exists.
  - Given all recipients fail, When the run ends, Then the final status pushed is `failed`.
- **Source refs:** `node/services/broadcastService.js` (executeBroadcastSchedule, updateBroadcastStatus, updateMessageStatus), `node/utils/sendSafety.js` (jitter, batch settings, daily cap, isSockUsable, isAuthTemplate), `node/utils/helpers.js` (refreshMessageSettings, laravelHeaders), `Documentation/pages/messaging/broadcasts.html`.
- **Port notes:** BullMQ worker per sender concurrency 1; persist progress; add a resumable `paused` state that Laravel/Nest accepts; make the cap configurable via settings and share the tally in Redis.

### TW-BCAST-023 — Node message rendering per engine (Baileys, WABA, Twilio)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-BCAST-022
- **Summary:** How a template becomes an actual message on each engine, including personalization, media, buttons, carousel and location.
- **Actors & access:** Node internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `templateData` blob (TW-BCAST-016), contact row, `tracked_bodies`.
- **Rules & edge cases:**
  1. Placeholder substitution (`replaceAttributePlaceholders`): step 1 translates positional `{{1}}` to named `{{key}}` using the template `variable_map`, accepting both the flat form `{"1":"name"}` and the stored nested form `{header:[{num,key}], body:[...]}` (body wins on collisions). Step 2 replaces each `{{token}}` (letters, digits, dot, dash, underscore, spaces allowed; tolerant of case and separators, tries the raw key, lowercase and snake_case) with the value from the contact object, else from `custom_attributes`; an unresolved token is left literally as `{{token}}`, so recipients can receive raw placeholders on Baileys/Twilio (contrast: the WABA prebuild path blanks unknown tokens and uses "there" for empty name slots).
  2. `tracked_bodies[contact.id]` (when present) replaces the shared body before substitution (TW-BCAST-018). Header and footer are substituted separately.
  3. Baileys (`sendTemplateMessage`): carousel templates go through `sendCarouselMessage` with per-card title/body/footer/image (image path resolution: `image_path`, `image_filename` or `image` under `/storage/wa-templates/`); media + buttons => one interactive message with caption = body and footer, media from the inlined base64 (preferred; decoded per recipient) or downloaded from the URL after an HTTPS assertion; a media failure marks the recipient failed with "attachment-missing:<reason>" (never sends text-only); buttons only (no media) => interactive buttons message with body + footer; media only => caption = body plus a blank line plus the footer; otherwise plain text = body plus blank line plus footer. Interactive button formatting caps at 3 buttons. If the template has a header location, a location pin message is sent right after a successful body.
  4. Baileys freeform (no template): plain text of `message`. Recipient JID = digits of the phone plus `@s.whatsapp.net`.
  5. WABA (`buildWabaPayload`): if `meta_payloads[contact.id]` exists it is sent verbatim as `type:template` (fast path). Otherwise the legacy builder: with a variable map and a template name it sends a template with header and body text parameters only (buttons, carousel and media headers are dropped, causing Meta errors 132000/132012, which is why TW-BCAST-017 prebuilds those); without a variable map it falls back to plain text (header wrapped in asterisks, footer in underscores) or a media message with the caption. Number = country code + mobile if both present else the digits of `phone`.
  6. Twilio: `sendTwilioBulkMessage` sends a Content template (ContentSid + content variables built from the contact) when the template has `twilio_content_sid`, else a plain media/text body (loses template approval semantics).
  7. Success returns the provider message id which is what receipts and billing key on.
- **Async & events:** none.
- **External systems:** Baileys, Meta Graph API `messages`, Twilio Messages API (credentials from WABA/Twilio provider configs resolved by Laravel per sender phone).
- **Settings:** none specific.
- **Acceptance criteria:**
  - Given a Baileys text template `Hi {{1}}` with variable map slot 1 = `first_name`, When sent to a contact with first_name "Asha", Then the message reads `Hi Asha`.
  - Given a Baileys template whose image cannot be decoded or downloaded, When sent, Then that recipient is failed with an "attachment-missing" error and no text-only message is sent.
  - Given a body token with no matching contact field, When sent on Baileys, Then the literal `{{token}}` is delivered (Reference behavior; port should blank it consistently).
  - Given a Twilio template without a ContentSid, When sent, Then a plain text body is sent.
- **Source refs:** `node/services/broadcastService.js`, `node/utils/sendSafety.js` (sendTwilioBulkMessage, assertHttpsMedia), `node/utils/helpers.js` (formatPhoneNumber, formatInteractiveButtonsForBaileys, downloadAndPrepareMediaBaileys), `node/utils/campaignHelpers.js` (sendCarouselMessage).
- **Port notes:** Implement as engine adapters (`packages/providers`): Baileys, WABA Cloud, Twilio; one shared "render template for recipient" function used by campaigns, broadcasts and scheduled sends.

### TW-BCAST-024 — Baileys delivery and read receipt forwarding

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-022
- **Summary:** When WhatsApp reports that a message sent by a Baileys broadcast was delivered or read, Node forwards it to Laravel so the recipient row moves forward.
- **Actors & access:** Node internal.
- **UX & screens:** none.
- **Endpoints:** posts to Laravel `POST api/update-message-status`.
- **Data:** in-memory `sentMessages` of the broadcast entries.
- **Rules & edge cases:**
  1. On each Baileys message-update event Node maps status 3 (DELIVERY_ACK) to `delivered`, 4 (READ) to `read`, 5 (PLAYED) to `read`; statuses 1/2 are ignored so a `sent` row is never demoted.
  2. It looks for a scheduled entry whose `sentMessages` contains the wamid; if found it posts `{broadcast_id, contact_id, status, whatsapp_message_id, delivered_at|read_at (ISO)}`. If not found the receipt is treated as a non-broadcast message and posted to `api/chat/message-status`.
  3. QUIRK: the lookup is in-memory only; after a Node restart, or for sends whose entry is gone, broadcast receipts are diverted to the chat endpoint and lost for the broadcast. Read receipts require the recipient to have read receipts enabled.
- **Async & events:** HTTP callbacks; failures are logged and dropped (no retry).
- **External systems:** Baileys events.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a broadcast message was sent (wamid W), When WhatsApp reports status 3, Then Laravel receives `delivered` for that broadcast and contact with `delivered_at`.
  - Given status 5 (played), When reported, Then Laravel receives `read`.
  - Given status 2 (server ack), When reported, Then nothing is posted.
- **Source refs:** `node/classes/BaileysClientManager.js` (handleMessageStatusUpdate, lines ~2650-2740).
- **Port notes:** Persist wamid to (broadcast, recipient) mapping in Postgres/Redis (the recipient row already stores `whatsapp_message_id`; match on that instead of memory).

### TW-BCAST-025 — Per-recipient status callback (Node to Laravel)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-BCAST-022
- **Summary:** Endpoint Node calls after every recipient transition. Laravel updates the recipient row and everything derived from it: counters, billing, inbox mirror and outbound webhooks.
- **Actors & access:** Node bridge only. Guard: header `X-Node-Token` compared with `hash_equals` against `node_token()` (system setting `node_webhook_token`, else `baileys_callback_token`, else env `NODE_WEBHOOK_TOKEN`); an empty configured token refuses everyone (HTTP 403 `{ok:false,message:'forbidden'}`). No session, no workspace scoping.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                     | Route name                     | Controller@action                      | Middleware | Request fields                                                                                                                                                                                               | Response                                                                         |
| ------------------------------ | ------------------------------ | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| POST api/update-message-status | broadcasts.node.message-status | BroadcastsController@nodeMessageStatus | api        | broadcast_id (int, required), contact_id (int, required), status (pending/sent/delivered/read/failed, required), error_message (<=1024), whatsapp_message_id (<=191), sent_at, delivered_at, read_at (dates) | `{ok:true}`; 404 `{ok:false,message:'broadcast not found'}`; 403; 422 validation |

- **Data:** updates `broadcast_contacts` where (broadcast_id, contact_id); recomputes `broadcasts` counters; billing tables; inbox tables.
- **Rules & edge cases:**
  1. Update only the fields supplied: `status` always; `error_message` and `whatsapp_message_id` only when non-empty; each timestamp parsed through Carbon and stored as `Y-m-d H:i:s` (a bad timestamp is skipped, not fatal); `updated_at = now`. The update is a raw query on the pivot (no model events, `error_message` lands as plaintext which the model tolerates through the SafeEncrypted cast).
  2. No monotonic guard here: a late `sent` callback after `delivered`/`read` can regress the row and a `pending` can overwrite anything. (Twilio and WABA paths use a state machine, TW-BCAST-027.)
  3. After the update the parent's cached counters are recomputed (`recomputeAggregates`, TW-BCAST-027): idempotent against duplicate callbacks because it recounts.
  4. Billing (only when a wamid is present): for status sent/delivered/read call `MessageBillingService::settleDelivered(workspace, wamid, contact mobile, effective Meta category of the template, engine, 'broadcast')`; for failed call `settleFailed(workspace, wamid)`. Idempotent per wamid; exceptions are swallowed with a warning log. Note the charge can therefore trigger on `sent`, earlier than "delivery" (WALLET owns the details).
  5. Inbox mirror on sent/delivered/read (TW-BCAST-028).
  6. Outbound webhook per status: sent => `message_sent`, delivered => `message_delivered`, read => `message_read`, failed => `message_failed` (pending => none), with payload `{workspace_id, broadcast_id, broadcast_name, template_id, contact_id, wamid, status, error_reason, timestamp, aggregate{sent, delivered, read, failed, clicked, total}}` dispatched for the broadcast's creator user.
  7. The broadcast is looked up by id only; there is no check that the contact is attached (an unknown contact just updates zero rows).
- **Async & events:** outbound webhooks (TW-BCAST-029), billing settle, inbox write.
- **External systems:** none.
- **Settings:** `node_webhook_token` / `baileys_callback_token` / `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given a valid token and `{broadcast_id:5, contact_id:9, status:'sent', whatsapp_message_id:'W1'}`, When posted, Then the pivot row becomes `sent` with the wamid, the broadcast's `success_count` includes it and `{ok:true}` is returned.
  - Given a missing or wrong token (or none configured), When posted, Then HTTP 403.
  - Given `status:'failed'` with `error_message`, When posted, Then the row shows the error, `fail_count` rises, the charge (if any) for that wamid is reversed and a `message_failed` webhook is dispatched.
  - Given the same `sent` callback twice, When posted, Then the counters stay the same and billing charges once.
  - Given an unknown `broadcast_id`, When posted, Then HTTP 404.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (nodeMessageStatus), `app/Models/Broadcast.php` (recomputeAggregates), `app/Models/BroadcastContact.php`, `routes/api.php` (lines 47-49), `app/Support/fc_helpers.php` (node_token), `app/Services/MessageBillingService.php`, `app/Services/WebhookService.php`.
- **Port notes:** Internal endpoint `POST /internal/broadcasts/:id/recipients/:cid/status` protected by service auth; if sending happens inside the worker no HTTP hop is needed, call a `BroadcastProgressService`. Add the monotonic state machine for all sources.

### TW-BCAST-026 — Run-level status callback (Node to Laravel)

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-BCAST-022
- **Summary:** Node reports the broadcast's lifecycle (processing at start, final outcome at the end) so the parent row carries the right status even if some per-recipient callbacks were lost.
- **Actors & access:** Node only; same `X-Node-Token` guard as TW-BCAST-025.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                       | Route name                       | Controller@action                        | Middleware | Request fields                                                                                                                                                    | Response                   |
| -------------------------------- | -------------------------------- | ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| POST api/update-broadcast-status | broadcasts.node.broadcast-status | BroadcastsController@nodeBroadcastStatus | api        | broadcast_id (int), status (scheduled, processing, completed, completed_with_errors, failed), success_count (int >= 0, optional), fail_count (int >= 0, optional) | `{ok:true}`; 404; 403; 422 |

- **Data:** updates `broadcasts.status`, `success_count`, `fail_count`, `completed_at`.
- **Rules & edge cases:**
  1. Updates status; `success_count`/`fail_count` are overwritten with the posted values when present (Node always sends numbers, including 0 at the `processing` push), otherwise kept.
  2. `completed_at` is set to now on the first terminal status (completed, completed_with_errors, failed) and is not changed afterwards (a retry run does not update it).
  3. The model `updated` hook fires `broadcast_status_updated` on status change and a notification (TW-BCAST-029).
  4. QUIRK: `paused` (sent by Node on socket drop / daily cap) is not in the allowed list, so Laravel answers 422 and the pause is dropped (TW-BCAST-022 rule 10).
  5. QUIRK: the posted counts describe only Node's current run. The `processing` push at the start of a run (including a retry run) writes 0/0 over the cached counters, and the final push of a retry run writes the retried subset's numbers over the totals, until the next per-recipient recompute (TW-BCAST-027) restores them. Since per-recipient callbacks recompute after every event, totals normally self-heal, but the last write wins if no later callback arrives (for example when all remaining retry recipients fail without callbacks).
- **Async & events:** `broadcast_status_updated` outbound webhook.
- **External systems:** none.
- **Settings:** same token settings.
- **Acceptance criteria:**
  - Given a valid token and `{broadcast_id, status:'completed', success_count:10, fail_count:0}`, When posted, Then the row is completed with `completed_at` set and counts 10/0.
  - Given `status:'paused'`, When posted, Then HTTP 422 (documented Reference behavior; the port should accept it).
  - Given a second terminal push, When posted, Then `completed_at` keeps its first value.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (nodeBroadcastStatus), `node/services/broadcastService.js` (updateBroadcastStatus).
- **Port notes:** Derive the terminal status from recipient rows inside the API instead of trusting the worker's numbers; accept `paused`.

### TW-BCAST-027 — Aggregate counters, status state machine and provider status webhooks

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-025
- **Summary:** The cached counters on the broadcast row (`success_count`, `delivered_count`, `read_count`, `fail_count`, `clicked_count`) and the rules by which recipient rows advance, fed by Node callbacks, Baileys receipts, Meta status webhooks and Twilio status webhooks.
- **Actors & access:** System.
- **UX & screens:** Numbers appear on the list rows, tiles and detail page.
- **Endpoints:** none of its own (the Meta webhook `POST webhooks/whatsapp/inbound` and the Twilio status endpoint `POST api/twilio/status` are owned by `whatsapp-cloud-api-waba`; the broadcast branches are described here).
- **Data:** `broadcast_contacts.status/timestamps`, `broadcasts` counters, `scheduled_message_contacts` (legacy/shared), `wa_link_clicks`.
- **Rules & edge cases:**
  1. Recipient statuses: `pending` (default), `processing` (only appears in the accessor's fallback and statistics endpoint; nothing writes it for broadcasts), `sent`, `delivered`, `read`, `failed`, and `undelivered` (only read by retry/sweeper; nothing writes it).
  2. `Broadcast::recomputeAggregates()` recounts `broadcast_contacts` grouped by status and writes (quietly, no events): `success_count = sent + delivered + read`, `delivered_count = delivered + read`, `read_count = read`, `fail_count = failed`. Cascade means higher tiers subsume lower ones. `clicked_count` is deliberately untouched (owned by the link redirect).
  3. Read side, `status_counts` accessor: fast path when any of success/fail/delivered/read/clicked counters is > 0 returns the cached counters plus `pending = max(0, total - success - fail)`, `processing = 0`; slow path (no counters yet) counts live `broadcast_contacts` rows by status and distinct clicked contacts from `wa_link_clicks`.
  4. Meta (WABA) status webhook: for each status update matched by wamid it (a) bills via the central settle (idempotent per wamid), (b) updates broadcast recipients found in `scheduled_message_contacts` by `wa_message_id` and, if not handled by that branch, in `broadcast_contacts` by `whatsapp_message_id`, (c) advances a row only if the state machine allows: rank pending/queued 1, sent 2, delivered 3, read 4, failed 5; a `failed` row never changes to a non-failed status; a `read` row ignores later delivered/sent/failed; otherwise incoming rank >= current rank; delivered/read set the timestamp once; failed stores `error_message` (Meta message, or `error_code:<code>`, cut to 512), (d) recomputes the parent counters, (e) fires the outbound webhook `broadcast_message_status_updated` with the error code/reason and the aggregate. Optional patch columns are filtered to those existing on the table.
  5. Twilio status callback: updates `broadcast_contacts` rows by `whatsapp_message_id` (message SID) with the same monotonic guard and read-implies-delivered rule, error text cut to 255. QUIRK: it does not recompute the parent broadcast counters, so the list and tiles (which read the cached columns) lag until the next Node per-recipient callback, while the detail page rows (live from the pivot) are right.
  6. Baileys receipts arrive via TW-BCAST-024 and use TW-BCAST-025 (no state machine).
  7. QUIRK (id-namespace collision): the Meta branch (b) queries `scheduled_message_contacts.scheduled_message_id` and treats that number as `broadcasts.id` when recomputing (`UPDATE broadcasts ... WHERE id = scheduled_message_id`). That table's FK points to `scheduled_messages`, so a scheduled message with id N that receives a WABA status will overwrite the counters of broadcast N. The detail page and the list "Processing/Queued" tiles read the same table by broadcast id (TW-BCAST-002/032). The rebuild must not share ids across these tables.
- **Async & events:** `broadcast_message_status_updated` webhook, billing settle.
- **External systems:** Meta webhooks, Twilio status callbacks.
- **Settings:** none.
- **Acceptance criteria:**
  - Given recipients {1 sent, 2 delivered, 1 read, 1 failed}, When recompute runs, Then success_count 4, delivered_count 3, read_count 1, fail_count 1.
  - Given a recipient at `read`, When a late `delivered` webhook arrives, Then the row stays `read`.
  - Given a recipient at `failed`, When a `sent` webhook arrives, Then it stays `failed`.
  - Given a broadcast with all counters 0 and 3 pivot rows `sent`, When the list renders, Then the slow path shows Sent 3.
  - Given a Twilio delivered callback, When processed, Then the recipient row is `delivered` (port requirement: counters update too).
- **Source refs:** `app/Models/Broadcast.php`, `app/Http/Controllers/WaWebhookController.php` (applyStatus branches 2 and 4, shouldAdvance, recomputeBroadcastAggregates, fireBroadcastWebhook), `app/Http/Controllers/TwilioStatusController.php`, `app/Http/Controllers/LinkRedirectController.php`.
- **Port notes:** One `RecipientStatusService.apply(recipientId|wamid, status, ts, error)` used by every source with a single state machine and counter maintenance (or compute counters with SQL views). Drop the scheduled_message_contacts dependency.

### TW-BCAST-028 — Team-inbox mirroring of broadcast sends

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-BCAST-025
- **Summary:** Broadcast messages appear in the team-inbox thread of recipients who already have a conversation, so agents see what the customer is replying to. Cold recipients get no new thread.
- **Actors & access:** System.
- **UX & screens:** Outbound bubble in the team inbox tagged with source `bulk`/`broadcast`, template name and buttons.
- **Endpoints:** none.
- **Data:** writes `inbox_messages` (direction out, body, meta incl. `broadcast_id`, `source`, `template_name`, `buttons`, `wa_message_id`, `src_key`) and updates conversation `last_message_at`, `last_outbound_at`, `preview` (first 200 chars); does not touch unread counts.
- **Rules & edge cases:**
  1. Trigger A (immediate dispatch): after Node accepts, `mirrorBroadcastToOpenInbox` writes one bubble per recipient that already has an open conversation (`InboxMirror::appendOutboundToOpenConversation`, no thread creation). Body = readable template text (header + body + footer of the template data) or the freeform message; empty body => nothing. Skipped entirely (logged) when the recipient count exceeds 2000. Scheduled sends skip trigger A.
  2. Trigger B (per-recipient status callback for sent, delivered or read): resolves the template body with this contact's variables (positional and named tokens, blank name slot => "there", double spaces collapsed) and mirrors with the wamid and `src_key = broadcast:<id>:contact:<contactId>`; an empty body is skipped. Any of the three statuses may create the bubble so a lost `sent` callback self-heals.
  3. De-duplication in `InboxMirror`: skip if a message with the same `meta.wa_message_id` exists in that conversation, or the same `meta.src_key`. Trigger A carries neither (wamid unknown, no src_key), so for an immediate send to a contact with an open thread trigger A creates a `pending` bubble and trigger B may create a second one (QUIRK, possible duplicate bubble; verify in live parity).
  4. Threads are located per sending number in multi-number workspaces; a non-matching number skips the mirror rather than misrouting.
  5. Best-effort: any exception is logged and swallowed; mirror failures never fail the send callback.
- **Async & events:** writes only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact with an open conversation, When a broadcast message to them is reported `sent`, Then their thread shows one outbound bubble with the resolved template text and buttons and unread count unchanged.
  - Given a contact with no conversation, When the broadcast is sent, Then no conversation is created.
  - Given the same message reports `sent` then `delivered`, When processed, Then only one bubble exists for that wamid.
  - Given an immediate broadcast to 5000 recipients, When Node accepts, Then trigger A is skipped (cap 2000) but trigger B still mirrors per callback.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (mirrorBroadcastToOpenInbox, nodeMessageStatus mirror block), `app/Services/Inbox/InboxMirror.php`.
- **Port notes:** Belongs to team-inbox (TIB1) as a `MessageMirror` consumer of recipient-status events; use the outbox event `broadcast.recipient.sent` instead of inline calls; dedupe on `(broadcast_id, contact_id)`.

### TW-BCAST-029 — Outbound webhooks and in-app notifications emitted by broadcasts

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-BCAST-015, TW-BCAST-025
- **Summary:** Broadcast lifecycle and per-message events are pushed to the customer's configured outbound webhooks and to the in-app notification bell.
- **Actors & access:** System; customers subscribe under Webhooks (INTG domain, plan feature `access_outbound_webhooks`).
- **UX & screens:** Notification bell entries "Broadcast created: <name>", "Broadcast updated: <name>", "Broadcast deleted: <name>" (category `broadcast`, icon broadcast, link `/broadcasts/<id>`; deleted = warning severity, no link).
- **Endpoints:** none.
- **Data:** notifications table (NOTIF), webhook subscriptions/deliveries (INTG).
- **Rules & edge cases:**
  1. Events and payloads: `broadcast_created` {workspace_id, user_id, broadcast_id, broadcast_name, template_id, status, total_recipients, timestamp}; `broadcast_status_updated` (only when `status` changed) adds previous_status and success/delivered/read/fail counts; `message_sent`/`message_delivered`/`message_read`/`message_failed` from the Node callback with an `aggregate` block; `broadcast_message_status_updated` from Meta status webhooks (with error code and reason and the aggregate); `campaign_contact_clicked` from the link redirect. Model-level events are emitted through the deferred, guarded `WebhookService::emit` so a webhook failure never breaks the write; the callback events use `WebhookService::dispatch` for the broadcast owner.
  2. Notifications come from the `LogsNotifications` trait on the model: every created, updated (non-quiet save with dirty fields) and deleted event records a notification for the broadcast's `user_id` (falling back to the acting user), stamped with the broadcast's own workspace. Counter recomputes use quiet saves (no notification), but each status change and dispatch update produces one ("Broadcast updated"), so a normal send generates several bell entries (created, updated x N). The port should collapse these to meaningful events (created, completed/failed).
- **Async & events:** as above.
- **External systems:** customer webhook endpoints.
- **Settings:** webhook subscriptions; notification preferences (NOTIF).
- **Acceptance criteria:**
  - Given an active webhook subscribed to `broadcast_created`, When a broadcast is created, Then a delivery with the payload above is queued.
  - Given a status change processing to completed, When saved, Then `broadcast_status_updated` carries previous_status `processing`.
  - Given a delete, When the row is removed, Then a "Broadcast deleted" warning notification is recorded.
- **Source refs:** `app/Models/Broadcast.php` (booted), `app/Models/Concerns/LogsNotifications.php`, `app/Helpers/NotificationHelper.php`, `app/Services/WebhookService.php`, `app/Http/Controllers/BroadcastsController.php`, `app/Http/Controllers/WaWebhookController.php`, `app/Http/Controllers/LinkRedirectController.php`.
- **Port notes:** Emit domain events through the outbox in the same transaction as the state change; INTG consumes them. Keep event names and payload keys for API/webhook parity.

### TW-BCAST-030 — Detail page shell: header, KPI tiles, tabs and live poll

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-035
- **Summary:** `GET /broadcasts/{id}` ("Broadcast analytics") is the per-broadcast dashboard with header actions, six KPI tiles that refresh while the broadcast is in flight, and four tabs (Overview, Recipients, Failures, Events).
- **Actors & access:** Owner/admin of the workspace that owns the broadcast (`forCurrentWorkspace`); another workspace's id returns 404. Route constraint: numeric id.
- **UX & screens:** `resources/views/user/broadcasts/show.blade.php`, JS `resources/js/charts/user-broadcasts-show.js` (ApexCharts). Sticky bar: back link, breadcrumb "Broadcasts / Analytics / #<id>", broadcast name, status pill (status with underscores as spaces, first letter capitalised, "Draft" if empty; colours: completed green, completed_with_errors and processing amber, scheduled grey, failed red), "Retry failed (N)" button when the failed count > 0 (TW-BCAST-038), "Delete" button when status is scheduled or failed (TW-BCAST-040). Header card: "Broadcast" label with the provider chip (Unofficial API / WABA / Twilio; none for sms or unknown), created time `M j, Y H:i` in the broadcast's timezone, and the sending device label + phone when a device resolves (`Device::find(device_id)`; label = device name or "Device #id", phone = `+<cc> <number>`); title "Broadcast analytics" and the line "Per-recipient delivery, read, and failure timeline for this template send." Tiles (`data-broadcast-live`): Sent (n, "x% of audience"), Delivered ("x% delivery rate"), Read ("x% of delivered"), Audience (total recipients), Queued ("awaiting send"), Failed ("x% failure rate"). Tabs with counts on Recipients and Failures. The full chart payload is embedded as `window.WA_BROADCAST_DATA`.
- **Endpoints:**

| Method uri          | Route name             | Controller@action         | Middleware                              | Request           | Response  |
| ------------------- | ---------------------- | ------------------------- | --------------------------------------- | ----------------- | --------- |
| GET broadcasts/{id} | user.broadcasts.detail | BroadcastsController@show | Authenticate, EnsureWorkspaceRole:admin | path id (numeric) | HTML view |

- **Data:** see TW-BCAST-031..034 for the derived structures; header numbers come from the merged recipient list: total = number of merged rows (can differ from `total_recipients`), sent = sent+delivered+read, delivered = delivered+read, read, failed, queued = pending rows; percentages: sent% and delivered% and failed% over total, read% over delivered, one decimal, 0 when the base is 0. A `clicked` unique-contact count and its percentage (over delivered) are computed but never rendered (TW-BCAST-042).
- **Rules & edge cases:**
  1. Recipient rows come from two sources merged per contact: `scheduled_message_contacts` where `scheduled_message_id = broadcast id` (preferred, live-updated, includes `failed_at`) and `broadcast_contacts` rows for contacts not present in the first set. Sorted by queued time descending. QUIRK: the first source is keyed by a scheduled-message id, so a scheduled message with the same numeric id contaminates this page (TW-BCAST-027 rule 7). Status defaults to `pending`.
  2. Contacts are hydrated in one query restricted to the current workspace, so a foreign contact id never leaks; unknown contacts show as "Contact #id" with no phone.
  3. Name = `name`, else `first_name last_name`, else "Contact #id". Phone = `+<country code digits> <mobile>` unless the mobile already begins with the country code, then the mobile as stored; empty when no mobile.
  4. All timestamps are rendered in the broadcast's own timezone (`wa_local`), format `M j, H:i:s`; the events tab uses ISO strings run through the same formatter.
  5. The controller also eager-loads all contacts and recipients (unused) which makes large broadcasts heavy; every recipient is rendered into the DOM with no pagination.
  6. Live poll (JS): `GET live-stats` immediately and then every 12 s while the tab is visible; stops when the response says `in_flight=false`; restarts on `visibilitychange`. It overwrites the Sent/Delivered/Read/Queued/Failed tiles, their percentage captions and the status pill text. It does not update the Audience tile, the tab counts, the charts or the recipient rows (a reload is needed for those). Live numbers come from `broadcast_contacts` only (TW-BCAST-035), so they can differ from the server-rendered numbers for rows that exist only in the shared table.
  7. Tab switching is client-side; a `resize` event is dispatched after each switch so ApexCharts lays out; charts are created on load.
- **Async & events:** polling only.
- **External systems:** ApexCharts (bundled), no CDN.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a broadcast with 10 recipients (4 read, 3 delivered, 2 sent, 1 failed), When the page loads, Then Sent shows 9 ("90% of audience"), Delivered 7 ("70% delivery rate"), Read 4 ("57.1% of delivered"), Failed 1 ("10% failure rate"), Queued 0.
  - Given a broadcast id from another workspace, When requested, Then HTTP 404.
  - Given the broadcast is processing, When 12 s pass, Then the tiles refresh from `live-stats`; when the status becomes completed the polling stops.
  - Given status `scheduled`, When the page loads, Then the Delete button is shown and the Retry button is not (no failures).
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (show), `resources/views/user/broadcasts/show.blade.php`, `resources/js/charts/user-broadcasts-show.js`, `app/Support/fc_helpers.php` (wa_local, wa_tz).
- **Port notes:** Paginate/stream recipients (server-side filter by status/search); compute header counts in SQL. Do not join on foreign id spaces. Resolve the device via the broadcast's own sender reference (the current code looks up `devices` even for WABA/Twilio slices whose `device_id` is a provider-config id, so the label can be wrong or missing).

### TW-BCAST-031 — Detail overview tab: delivery curve, status donut, funnel, template preview

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-BCAST-030
- **Summary:** Visual analytics of one send: hourly delivery curve, status mix donut, conversion funnel and a preview of the template that was used.
- **Actors & access:** As TW-BCAST-030.
- **UX & screens:** Card "Delivery curve / Sent, delivered, read over time" (area chart, smooth lines, three series Sent, Delivered, Read, legend dots, no toolbar, shared tooltip); card "Status mix / Where each message landed" (donut, centre label "Success" with a percentage, legend at the bottom); card "Conversion funnel / From send to read" (five horizontal bars: Audience 100%, Sent, Delivered, Read, Failed, each "count / pct%", bar width capped at 100%); a "Template preview" phone mock (template name in the header bar, category chip capitalised, header, body, footer of the stored template; no media or button rendering; placeholders are shown unresolved) only when the broadcast has a template.
- **Endpoints:** part of `GET broadcasts/{id}` (chart data embedded).
- **Data:** derived series (no storage).
- **Rules & edge cases:**
  1. Delivery curve buckets: start = the broadcast's `created_at` converted to the broadcast timezone and floored to the hour; end = the latest sent/delivered/read timestamp floored to the hour (or start + 1 h when there are none, and never before the start); bucket count = min(24, max(1, hours between + 1)); labels are `H:00` only (no date); each recipient's sent_at, delivered_at, read_at is counted in its hour bucket if the bucket exists. QUIRK: the origin is creation time, not send time, so a broadcast scheduled for days later has all its events outside the 24 buckets and the chart is flat zero; events after 24 hours are cut off. A rebuild should anchor on the first send.
  2. Donut series in order [Sent-not-yet-delivered = sent - delivered, Delivered-not-read = delivered - read, Read, Queued (pending), Failed] with those labels; colours in order deep-green, teal, amber, grey, coral. Centre "Success" = round((total - failed - queued) / total x 100) percent (0 when total is 0).
  3. Funnel percentages reuse the header percentages (TW-BCAST-030).
  4. The template lookup uses the broadcast's `template_id` with an unscoped find (safe because the broadcast itself is workspace scoped); preview category = `meta_category`, else `category`, else `utility`.
- **Async & events:** none.
- **External systems:** ApexCharts.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a broadcast created 10:20 whose events span 10:30 to 13:10 in `Asia/Kolkata`, When the page loads, Then the x-axis has labels 10:00 to 13:00 (4 buckets) with counts per hour.
  - Given 5 read, 3 delivered, 1 sent, 1 pending and 2 failed out of 12, When rendered, Then the donut series is [1,3,5,1,2] (sent-not-delivered, delivered-not-read, read, queued, failed) with centre "Success 75%".
  - Given no template, When rendered, Then the template preview card is omitted.
  - Given a broadcast scheduled 3 days after creation, When rendered, Then (Reference) the curve is empty; the port should anchor to send time.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (show: chartData), `resources/views/user/broadcasts/show.blade.php`, `resources/js/charts/user-broadcasts-show.js`, `resources/js/theme-colors.js`.
- **Port notes:** Use the shared chart component set; compute series server-side in SQL (`date_trunc('hour', ts AT TIME ZONE tz)`).

### TW-BCAST-032 — Detail recipients tab

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-030
- **Summary:** The per-recipient grid: who was messaged, current status, timestamps, click count and error or message id.
- **Actors & access:** As TW-BCAST-030.
- **UX & screens:** Tab "Recipients N". Header "Who got it, when" with a search input ("Search name / phone"), an "Export rows" button (TW-BCAST-037) and a status filter (All statuses, Pending, Sent, Delivered, Read, Failed). Table columns: Name, Phone (dash if none), Status (badge: read green, delivered mint, sent grey, failed red, pending muted), Sent, Delivered, Read (timestamps `M j, H:i:s` in broadcast timezone or dash), Clicks (count when > 0 else dash; tooltip "Last click: ..."), Error / WA id (error text in red, truncated with full text as title; else the first 16 chars of the WhatsApp message id; else dash). Empty: "No recipients attached."
- **Endpoints:** part of `GET broadcasts/{id}`.
- **Data:** merged recipient list (TW-BCAST-030); click counts from `wa_link_clicks` grouped by contact: sum of `clicks` and max `last_click_at` for rows of this broadcast with clicks > 0.
- **Rules & edge cases:**
  1. Filtering and search are client-side over the rendered rows (`data-status`, lowercase `data-search` of name + phone); there is no server-side paging so very large broadcasts render every row.
  2. The `queued_at` sort (created time of the recipient row) is descending; there is no user-selectable sort.
  3. Error text is stored encrypted-at-rest via a tolerant cast on the model but written as plaintext by the raw callbacks; reading through Eloquent works for both forms. The stored error may include the recipient phone or template body fragments when Node included them in the failure detail.
- **Async & events:** none (not live-polled).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a broadcast with 3 recipients, When the tab is opened, Then 3 rows show name, phone, status badge and timestamps in the broadcast timezone.
  - Given the admin selects status "Failed" and types a phone fragment, When applied, Then only matching failed rows remain visible.
  - Given a recipient tapped a tracked link twice, When rendered, Then Clicks shows 2 with the last click time as tooltip.
  - Given the contact was deleted, When rendered, Then the name shows "Contact #<id>".
- **Source refs:** `resources/views/user/broadcasts/show.blade.php`, `resources/js/charts/user-broadcasts-show.js`, `app/Http/Controllers/BroadcastsController.php` (show).
- **Port notes:** API `GET /broadcasts/:id/recipients?status=&q=&page=`; keep the same badge palette; add server-side pagination.

### TW-BCAST-033 — Detail failures tab and failure-reason histogram

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BCAST-030
- **Summary:** Groups failed recipients by error text so recurring problems (invalid numbers, expired media, quota) stand out.
- **Actors & access:** As TW-BCAST-030.
- **UX & screens:** Tab "Failures N". Left card "Failure reasons / Top errors": horizontal bar chart (or the empty message "No failures so far. Every recipient was reached."). Right card "Affected recipients" with a heading "N failure(s)" and a table Name, Phone, Error ("Unknown" when empty).
- **Endpoints:** part of `GET broadcasts/{id}`.
- **Data:** failed rows of the merged list.
- **Rules & edge cases:** reason key = trimmed error text (case-sensitive exact string, "Unknown" when null/empty); counts sorted descending; the top 8 kept and the remainder summed into an "Other" bar; the chart renders only when at least one failure exists. Long distinct error strings (containing phone numbers) will not group; a port should normalise error codes.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 5 failures "Not on WhatsApp" and 2 "Media download failed", When rendered, Then two bars show 5 and 2.
  - Given 10 distinct error strings, When rendered, Then 8 bars plus an "Other" bar summing the remaining two.
  - Given no failures, When the tab is opened, Then the empty message is shown and no chart is created.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (show: failureRows, failuresChart), `resources/views/user/broadcasts/show.blade.php`, `resources/js/charts/user-broadcasts-show.js`.
- **Port notes:** Store a normalised `error_code` + `error_message` on the recipient row and group on the code.

### TW-BCAST-034 — Detail events tab

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-BCAST-030
- **Summary:** A four-item lifecycle timeline of the broadcast.
- **Actors & access:** As TW-BCAST-030.
- **UX & screens:** Tab "Events": heading "Timeline of this broadcast", vertical list: Created (created_at), Scheduled at (scheduled_at), Status (current status text, underscores as spaces, first letter capitalised), Completed (completed_at). Times formatted `M j, H:i:s` in the broadcast timezone; missing values show a dash.
- **Endpoints:** part of `GET broadcasts/{id}`.
- **Data:** `created_at`, `scheduled_at`, `status`, `completed_at`.
- **Rules & edge cases:** there is no real event log (no per-status history); Scheduled at is the row value even for immediate sends (equal to creation time).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a completed broadcast, When the tab opens, Then Created, Scheduled at, Status "Completed" and Completed timestamps are shown.
  - Given a processing broadcast, When the tab opens, Then Completed shows a dash.
  - Given the broadcast timezone is `Asia/Kolkata`, When rendered, Then times are shifted from UTC accordingly.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (show: events), `resources/views/user/broadcasts/show.blade.php`.
- **Port notes:** Could be fed from an audit-event stream (created, dispatched, paused, resumed, completed, retried).

### TW-BCAST-035 — Live-stats JSON endpoint

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-BCAST-025
- **Summary:** Cheap polling endpoint feeding the detail page tiles while a broadcast is running.
- **Actors & access:** Owner/admin, workspace scoped (404 for others' ids).
- **UX & screens:** Consumed by TW-BCAST-030.
- **Endpoints:**

| Method uri                     | Route name                 | Controller@action              | Middleware                              | Request | Response                                                                                                         |
| ------------------------------ | -------------------------- | ------------------------------ | --------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| GET broadcasts/{id}/live-stats | user.broadcasts.live-stats | BroadcastsController@liveStats | Authenticate, EnsureWorkspaceRole:admin | path id | `{status, total, sent, delivered, read, failed, queued, pct{sent,delivered,read,failed}, in_flight, fetched_at}` |

- **Data:** one `GROUP BY status` over `broadcast_contacts` for the broadcast; `broadcasts.status`, `total_recipients`.
- **Rules & edge cases:**
  1. Cascade: delivered += read; sent += delivered (after that adjustment); failed as is; queued = max(0, total_recipients - sent - failed) (note: computed from the row total, not the count of pending rows, so recipients dropped for having no phone count as queued forever).
  2. `pct` values = count / total_recipients x 100 rounded to 1 decimal (0.0 when total is 0).
  3. `in_flight` is true for statuses processing, sending, scheduled, pending, queued; the page stops polling when false.
  4. Ignores `scheduled_message_contacts`, unlike the server-rendered page.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given rows {2 sent, 1 delivered, 1 read, 1 failed} and total 5, When called, Then sent 4, delivered 2, read 1, failed 1, queued 0, pct.sent 80.0.
  - Given status `completed`, When called, Then `in_flight` is false.
  - Given another workspace's broadcast id, When called, Then HTTP 404.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (liveStats), `resources/js/charts/user-broadcasts-show.js`.
- **Port notes:** Return counters from the cached columns; add ETag/304 support.

### TW-BCAST-036 — Statistics JSON endpoint

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-BCAST-025
- **Summary:** Recipient-level status counts as JSON. No web screen calls it; the REST API v1 recipients endpoint reuses it.
- **Actors & access:** Owner/admin; workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                     | Route name                 | Controller@action               | Middleware                              | Request | Response                                                                    |
| ------------------------------ | -------------------------- | ------------------------------- | --------------------------------------- | ------- | --------------------------------------------------------------------------- |
| GET broadcasts/{id}/statistics | user.broadcasts.statistics | BroadcastsController@statistics | Authenticate, EnsureWorkspaceRole:admin | path id | `{success:true, stats:{sent, delivered, read, failed, processing, queued}}` |

- **Data:** `GROUP BY status` on the broadcast's recipient relation.
- **Rules & edge cases:** cascade as elsewhere (sent = sent+delivered+read; delivered = delivered+read; read; failed; processing = rows with status `processing`; queued = rows `pending`). Response uses `success` (not `ok`) unlike sibling endpoints.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given rows {1 pending, 2 sent, 1 read}, When called, Then queued 1, sent 3, delivered 1, read 1.
  - Given a foreign id, When called, Then 404.
  - Given no recipients, When called, Then all zeros.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (statistics), `app/Http/Controllers/Api/V1/BroadcastController.php` (consumer).
- **Port notes:** Fold into the REST recipients/summary endpoint.

### TW-BCAST-037 — Per-recipient CSV export

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BCAST-032
- **Summary:** Download the recipient grid as a CSV, reachable from the list row and the detail page.
- **Actors & access:** Owner/admin; workspace scoped.
- **UX & screens:** "Export rows" icon button on each list row and text button on the recipients tab.
- **Endpoints:**

| Method uri                 | Route name             | Controller@action           | Middleware                              | Request | Response                                                                                                |
| -------------------------- | ---------------------- | --------------------------- | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| GET broadcasts/{id}/export | user.broadcasts.export | BroadcastsController@export | Authenticate, EnsureWorkspaceRole:admin | path id | streamed download `text/csv; charset=UTF-8`, filename `broadcast-<id>-recipients-<YYYYMMDD-HHMMSS>.csv` |

- **Data:** the same merged recipient list as the detail page, contacts hydrated within the workspace, click counts.
- **Rules & edge cases:**
  1. Columns in order: Recipient, Phone, Status, Clicked, Queued, Sent, Delivered, Read, Failed, Last event, Error.
  2. Phone = digits only: country code digits + mobile digits unless the mobile already starts with the country code (no `+`, no spaces).
  3. Status is the capitalised status (default Pending); Clicked = Yes when the contact has click count > 0, else No.
  4. Time cells `Y-m-d H:i` in the workspace timezone (`wa_tz()`, not the broadcast's timezone, unlike the detail page); blank when unset.
  5. "Last event" = Button tap if clicked, else Read, Delivered, Sent, Failed (when failed_at present), otherwise Queued.
  6. CSV formula-injection guard: a text cell whose first character is `=`, `+`, `-` or `@` is prefixed with an apostrophe (applies to name, phone and error).
  7. Streamed with `fputcsv` (comma, standard quoting); no row cap; no BOM.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a broadcast with 2 recipients, When exported, Then the file has a header plus 2 lines and the filename pattern above.
  - Given a contact named `=HYPERLINK("x")`, When exported, Then the cell starts with `'=`.
  - Given a recipient who clicked, When exported, Then Clicked = Yes and Last event = Button tap.
  - Given another workspace's broadcast, When requested, Then 404.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (export).
- **Port notes:** Stream from a DB cursor; consistent timezone with the UI (use the broadcast timezone or user preference).

### TW-BCAST-038 — Manual retry of failed recipients

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-016
- **Summary:** One click re-sends only to recipients that failed, without touching those already delivered.
- **Actors & access:** Owner/admin; workspace scoped.
- **UX & screens:** "Retry failed (N)" pill on the detail header (visible only when failed > 0); confirm dialog "Re-send to all previously-failed recipients?"; on success a toast with the server message and a page reload after 800 ms; on failure a toast with the server message or "Retry failed."/"Network error retrying."; the button shows "Retrying..." and is disabled during the call.
- **Endpoints:**

| Method uri                        | Route name                   | Controller@action                | Middleware                              | Request | Response                                                                                                                                               |
| --------------------------------- | ---------------------------- | -------------------------------- | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST broadcasts/{id}/retry-failed | user.broadcasts.retry-failed | BroadcastsController@retryFailed | Authenticate, EnsureWorkspaceRole:admin | path id | `{ok:true, retried:N, status, message:'Retrying N failed recipients.'}`; 400 `{ok:false, error:'no_failed', message:'No failed recipients to retry.'}` |

- **Data:** updates `broadcast_contacts` (status failed or undelivered => `pending`, `error_message` null, `whatsapp_message_id` null, `updated_at`), `broadcasts.status` => `processing`.
- **Rules & edge cases:**
  1. Eligible rows: status `failed` or `undelivered` (only `failed` is ever produced). None => 400 "No failed recipients to retry." (docs message).
  2. The contact ids of those rows are passed to dispatch so Node receives only that subset (no duplicates to delivered recipients, no double charge because billing is per wamid).
  3. Always dispatches as an immediate send (`send-immediate`), even if the broadcast was scheduled.
  4. No status precondition: retry is allowed while the broadcast is `processing` (concurrent second loop possible), and it is not blocked by plan, wallet, warmer or template guards (none is re-evaluated).
  5. The catch block for a dispatch exception (500 "dispatch_failed") is effectively unreachable because `dispatchToBridge` swallows its own errors; a bridge failure sets the row to `failed` and the endpoint still returns `ok:true` (with `status:'failed'` and the message "Retrying N failed recipients.").
  6. `send_attempts` (the auto-retry counter) is not reset or incremented by a manual retry; `completed_at` is not cleared.
  7. Retry of an SMS broadcast re-runs the SMS runner synchronously for the subset.
- **Async & events:** status change fires `broadcast_status_updated` (+ notification); Node run as usual (callbacks reset counters to 0/0 at the start, TW-BCAST-026).
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a broadcast with 3 failed recipients, When retry is clicked and confirmed, Then those 3 rows become pending with errors cleared, status becomes processing and Node receives exactly those 3 contacts.
  - Given no failed recipients, When the endpoint is called, Then HTTP 400 with the no-failures message.
  - Given already delivered recipients, When retry runs, Then they are not messaged again.
  - Given a foreign workspace id, When called, Then 404.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (retryFailed, redispatchFailed), `resources/js/charts/user-broadcasts-show.js`, `resources/views/user/broadcasts/show.blade.php`, `Documentation/pages/messaging/broadcasts.html`.
- **Port notes:** Require a status precondition (not running), re-run the guards (wallet, warmer, pause list) and make the operation idempotent with a retry-batch id.

### TW-BCAST-039 — Automatic retry sweeper with backoff

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-BCAST-038
- **Summary:** A background sweep that automatically re-sends failed recipients of recent broadcasts a limited number of times with exponential backoff, so an offline-device blast recovers without manual action.
- **Actors & access:** System. Triggered by the Node heartbeat.
- **UX & screens:** none.
- **Endpoints:** invoked inside `POST api/node-heartbeat` (`WaConnectController@nodeHeartbeat`, domain `node-bridge-runtime`) through `BroadcastSweeper::sweep()`.
- **Data:** reads `broadcasts` joined to `broadcast_contacts`; writes `broadcasts.send_attempts`, `next_attempt_at`, `status`.
- **Rules & edge cases:**
  1. Trigger chain: Node posts a heartbeat every 30 s but only while at least one client is registered and ready (Baileys). The Laravel side runs the broadcast sweep at most once per 120 s (cache key `broadcast-sweep-throttle`) inside a 25 s cache lock (`broadcast-sweeper`). QUIRK: workspaces that use only WABA/Twilio (no Baileys socket) never trigger the sweep because the heartbeat is skipped when no device is connected.
  2. Candidate selection: broadcasts having at least one recipient with status `failed` or `undelivered`, whose own status is not draft, cancelled or scheduled (so `processing`, `completed`, `completed_with_errors`, `failed` all qualify; QUIRK: a still-running broadcast can be re-dispatched while its first loop continues), created within the last 7 days, and (`next_attempt_at` null or due); distinct ids, limited to 20 per sweep, no explicit ordering.
  3. Per broadcast: max attempts and backoff come from `RetryPolicy` for feature `broadcast`: per-workspace override `plan_overrides['broadcast_retry_attempts'|'broadcast_retry_backoff_sec']`, else system settings `broadcast_retry_attempts` / `broadcast_retry_backoff_sec`, else defaults 3 attempts and 60 s base; attempts is at least 1; delay before attempt n = min(3600, base x 2^(n-1)) seconds (base 0 = immediate). If `send_attempts >= max` the broadcast is skipped and its failures are left for manual review.
  4. Before dispatching, the sweeper records `send_attempts + 1` and `next_attempt_at = now + delay` so a crash cannot spin. Then `redispatchFailed` resets the failed rows to pending (error cleared), sets status `processing` and dispatches only those contact ids immediately. Success/failure of the dispatch is logged (`[BCAST-SWEEP]`); errors are swallowed per broadcast.
  5. Permanent failures (invalid number, opted-out) are retried like any other, up to the cap (up to 3 extra messages attempts to bad numbers per recipient per default policy).
  6. Pending (never attempted) recipients, for example after a socket-drop pause, are not swept.
- **Async & events:** Node heartbeat, cache lock, log lines.
- **External systems:** Node bridge.
- **Settings:** `broadcast_retry_attempts` (default 3), `broadcast_retry_backoff_sec` (default 60), workspace `plan_overrides` of the same keys.
- **Acceptance criteria:**
  - Given a completed_with_errors broadcast created yesterday with 2 failed recipients and `send_attempts=0`, When the sweep runs, Then the two recipients are re-dispatched, `send_attempts=1` and `next_attempt_at` about 60 s ahead.
  - Given `send_attempts` equals the max, When the sweep runs, Then the broadcast is skipped.
  - Given a broadcast created 8 days ago, When the sweep runs, Then it is ignored.
  - Given two heartbeats within 120 s, When processed, Then only the first runs the sweep.
- **Source refs:** `app/Services/BroadcastSweeper.php`, `app/Services/RetryPolicy.php`, `app/Http/Controllers/WaConnectController.php` (nodeHeartbeat ~ line 767), `node/index.js` (startDeviceHeartbeat).
- **Port notes:** Implement as a BullMQ repeatable job (per tenant or global) independent of any Baileys heartbeat, exclude running broadcasts, skip non-retryable error codes, and reset attempts on manual retry.

### TW-BCAST-040 — Delete a scheduled or failed broadcast

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BCAST-021
- **Summary:** Removes a broadcast that has not started or has failed, cancelling its Node schedule first.
- **Actors & access:** Owner/admin; workspace scoped.
- **UX & screens:** Trash icon on list rows (only for scheduled or failed) with a "Delete broadcast?" danger confirmation ("Delete "<name>"? This can't be undone."), followed by a list refresh; failure toast "Delete failed: <message>". On the detail page a Delete button submits a native form (POST with `_method=DELETE`, confirm "Delete this broadcast?"). QUIRK: the endpoint returns JSON, so after that form submit the browser shows the raw JSON document instead of returning to the list.
- **Endpoints:**

| Method uri             | Route name              | Controller@action            | Middleware                              | Request | Response                                                                                                                                            |
| ---------------------- | ----------------------- | ---------------------------- | --------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| DELETE broadcasts/{id} | user.broadcasts.destroy | BroadcastsController@destroy | Authenticate, EnsureWorkspaceRole:admin | path id | `{ok:true, data:{id}, meta:<status counts of the workspace>}`; 422 `{ok:false, message:'Only scheduled or failed broadcasts can be deleted.'}`; 404 |

- **Data:** deletes `broadcasts`; detaches `broadcast_contacts` (rows also cascade by FK).
- **Rules & edge cases:**
  1. Allowed only when status is `scheduled` or `failed`; processing, completed and completed_with_errors are protected (history is kept; completed ones can be reused as an audience "queue" in Scheduled Messages).
  2. If `node_schedule_id` exists and a Node URL is configured, a best-effort `DELETE {node}/api/broadcast/cancel/{id}` (5 s timeout) runs first; failures are logged and ignored. The web flow has no way to stop a `processing` broadcast (the REST API has a `stop`).
  3. `wa_link_clicks` rows and the warmer reservation are not removed or refunded; billing already made per delivered message is not reversed.
  4. Deleting fires a "Broadcast deleted" notification (warning). The response `meta` carries `statusCounts` for the workspace.
- **Async & events:** Node cancel call, notification.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a scheduled broadcast with a Node schedule id, When deleted, Then Node's cancel endpoint is called and the row and its recipients are gone.
  - Given a completed broadcast, When deleted, Then HTTP 422 with "Only scheduled or failed broadcasts can be deleted."
  - Given Node is unreachable, When a scheduled broadcast is deleted, Then the row is still deleted.
  - Given a foreign workspace id, When deleted, Then 404.
- **Source refs:** `app/Http/Controllers/BroadcastsController.php` (destroy), `resources/views/user/broadcasts/_rows.blade.php`, `resources/views/user/broadcasts/show.blade.php`, `resources/js/charts/user-broadcasts-index.js`.
- **Port notes:** Cancel the BullMQ job by id; return 204 and redirect on the detail page. Consider soft delete for audit and a real "cancel running broadcast" action.

### TW-BCAST-041 — Recipients-per-broadcast plan cap (advertised, not enforced)

- **Status:** docs-only
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BCAST-009
- **Summary:** The plan editor exposes a "Recipients per broadcast" limit (`packages.broadcast_size_limit`, default 0), but no broadcast code reads it, so no plan actually limits audience size.
- **Actors & access:** Platform super-admin sets it in the package editor; workspaces are never restricted by it.
- **UX & screens:** Admin package create/edit form field "Broadcast size" (label in the feature grid "Recipients per broadcast"); no workspace-facing message exists.
- **Endpoints:** admin packages endpoints (PLAN domain).
- **Data:** `packages.broadcast_size_limit` int default 0.
- **Rules & edge cases:** grep shows the column only in the Package model (fillable/cast/label) and admin form lists; `store()` checks `broadcast_limit` (count of broadcasts) but never `broadcast_size_limit`. The mobile queue and REST API paths likewise do not check it. A rebuild should decide: enforce it at store (refuse when resolved audience exceeds the cap, with a clear message) or drop the field.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `packages.broadcast_size_limit`.
- **Acceptance criteria:**
  - Given a plan with `broadcast_size_limit=100` (port requirement), When an admin submits an audience of 101, Then the request is refused naming the limit.
  - Given the limit is 0, When any audience size is submitted, Then it is allowed (0 = unlimited).
  - Given Reference as shipped, When an audience of 10 000 is submitted on a plan with limit 100, Then it is accepted (documented gap).
- **Source refs:** `app/Models/Package.php`, `app/Http/Controllers/AdminPagesController.php` (line ~109), `resources/views/admin/packages/create.blade.php`.
- **Port notes:** Implement in the plan entitlement service as `broadcast.max_recipients`; check after audience resolution.

### TW-BCAST-042 — Click analytics surfaces (list column, recipient clicks; header tile missing)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-BCAST-018
- **Summary:** Where click data is visible. The documentation promises a "Clicked" summary tile with click-through rate; the UI only has the list column, per-recipient click counts and CSV data.
- **Actors & access:** As TW-BCAST-001/030.
- **UX & screens:** Present: list column "Clicked" (value from cached `clicked_count`, coloured when > 0), recipients-tab "Clicks" column, CSV "Clicked" and "Last event = Button tap", `stats.clicked` in the list JSON. Absent: a Clicked tile on the list KPI strip or detail header, a click-through-rate figure, a clicked step in the funnel (the values `clicked` and `clicked_pct` = unique clicking contacts over delivered are computed in `show()` but never rendered).
- **Endpoints:** none of its own.
- **Data:** `broadcasts.clicked_count`, `wa_link_clicks`.
- **Rules & edge cases:** `clicked_count` counts unique contacts (TW-BCAST-018); the recipients tab sums `clicks` over all of the contact's links for this broadcast. Documentation page states the tile and CTR exist; treat as not implemented.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 2 of 10 delivered recipients clicked, When the port shows the header, Then a Clicked tile shows 2 and 20.0% of delivered (Reference lacks this tile).
  - Given the list, When a broadcast has `clicked_count` 3, Then the Clicked column shows 3.
  - Given the recipients tab, When a contact clicked twice, Then Clicks shows 2.
- **Source refs:** `resources/views/user/broadcasts/_rows.blade.php`, `resources/views/user/broadcasts/show.blade.php`, `app/Http/Controllers/BroadcastsController.php` (show header), `Documentation/pages/messaging/broadcasts.html`.
- **Port notes:** Add the tile and funnel step.

### TW-BCAST-043 — Demo seed data (BroadcastSeeder)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** -
- **Summary:** A seeder that wipes all broadcasts and creates three demo ones (completed, processing, scheduled) with recipient rows from the first eight contacts.
- **Actors & access:** Developers/installers running `db:seed`.
- **UX & screens:** none; the rows have no workspace, user or provider, so they are invisible in the UI (workspace and engine scopes hide them).
- **Endpoints:** none.
- **Data:** creates "New Year VIP drop" (completed, 45 min duration, mix read 5 / delivered 2 / sent 1), "Welcome offer v3" (processing, mix delivered 4 / sent 3 / processing 1) and "Invoice reminder batch" (scheduled in two days at 09:00, 8 pending), timezone `Asia/Kolkata`; `success_count` = read+delivered+sent of the mix; `total_recipients` = mix total.
- **Rules & edge cases:** `Broadcast::query()->delete()` first (destructive, all workspaces); returns early when there are no contacts; the docblock says "idempotent firstOrCreate" but the code deletes and recreates; delivered/read counters are not seeded so the list shows Delivered/Read 0 for these rows.
- **Async & events:** model events fire (webhooks/notifications) during seeding.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 8+ contacts exist, When the seeder runs, Then exactly 3 broadcasts exist with the statuses above.
  - Given no contacts, When the seeder runs, Then all broadcasts are deleted and nothing is created.
  - Given the seeded rows, When an admin opens `/broadcasts`, Then (Reference) none is listed because they lack a workspace/provider.
- **Source refs:** `database/seeders/BroadcastSeeder.php`.
- **Port notes:** Provide a dev-only fixture per tenant instead; do not delete existing data.

## Data model

### `broadcasts` (owned; one row per sender slice of a send-out, and also one row per mobile "queue")

Purpose: the parent record of a bulk send. Read/written by TW-BCAST-001, -002, -009, -015, -016, -020, -025, -026, -027, -030 to -040. Expected volume: tens to thousands per tenant.

| Column                                                                                         | Type / default                                | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                                                                                             | bigint unsigned PK                            | Also shown as "BR-0001" (zero padded to 4).                                                                                                                                                                                                                                                                                                                                                                                          |
| user_id                                                                                        | bigint null, no FK                            | Creator ("created by", not a visibility filter). Seeder rows have null.                                                                                                                                                                                                                                                                                                                                                              |
| workspace_id                                                                                   | bigint null, FK workspaces ON DELETE SET NULL | Tenant scope. Null rows are only visible to their `user_id` (legacy). Port: NOT NULL + RLS.                                                                                                                                                                                                                                                                                                                                          |
| provider                                                                                       | varchar(16) null, indexed                     | Engine that carries this slice: `baileys`, `waba`, `twilio`, `sms` (auto-stamped from the workspace default engine on create if empty). Drives list scoping, Node routing and the provider chip.                                                                                                                                                                                                                                     |
| device_id                                                                                      | bigint null, indexed                          | Sender id in the engine's own table (`devices.id` for baileys; `wa_provider_configs.id` for waba/twilio/sms). Null = device-less legacy slice. No FK.                                                                                                                                                                                                                                                                                |
| template_id                                                                                    | bigint null, indexed                          | `wa_templates.id`; null allowed (validation does not require it).                                                                                                                                                                                                                                                                                                                                                                    |
| template_overrides                                                                             | longtext null, cast encrypted array           | Sanitized send-time overrides `{header:{mode,text                                                                                                                                                                                                                                                                                                                                                                                    | media_url}, body:[], footer:[], buttons:[{index,sub_type,value}]}`. |
| name                                                                                           | text NOT NULL, cast encrypted                 | Operator label; slices of a fan-out get " · <sender label>" appended. Searched in PHP only.                                                                                                                                                                                                                                                                                                                                          |
| timezone                                                                                       | text null, cast encrypted                     | IANA zone chosen in the form (default `UTC` when not posted). Used for display and forwarded to Node.                                                                                                                                                                                                                                                                                                                                |
| status                                                                                         | varchar(32) default `scheduled`, indexed      | Written values: `scheduled`, `processing`, `completed`, `completed_with_errors`, `failed`. `Broadcast::STATUSES` lists exactly these. Also referenced but never written by the web flow: `paused` (Node only, rejected by callback validation), `draft`, `cancelled` (sweeper exclusion list), `sending`, `pending`, `queued`, `running`, `active` (dashboard/live-stats inclusion lists; probably from the mobile queue or legacy). |
| send_attempts                                                                                  | tinyint unsigned default 0                    | Auto-retry rounds already made by the sweeper.                                                                                                                                                                                                                                                                                                                                                                                       |
| next_attempt_at                                                                                | timestamp null                                | Earliest next sweep for this broadcast.                                                                                                                                                                                                                                                                                                                                                                                              |
| scheduled_at                                                                                   | timestamp null, indexed                       | Send instant (now for immediate). Interpreted in the app timezone (see TW-BCAST-015 rule 1).                                                                                                                                                                                                                                                                                                                                         |
| completed_at                                                                                   | timestamp null                                | Set once on first terminal status.                                                                                                                                                                                                                                                                                                                                                                                                   |
| node_schedule_id                                                                               | varchar(255) null                             | Node's schedule id, used to cancel.                                                                                                                                                                                                                                                                                                                                                                                                  |
| total_recipients                                                                               | uint default 0                                | Number of contacts attached to this slice.                                                                                                                                                                                                                                                                                                                                                                                           |
| success_count                                                                                  | uint default 0                                | Cached: sent + delivered + read (anything accepted by the provider).                                                                                                                                                                                                                                                                                                                                                                 |
| delivered_count                                                                                | uint default 0                                | Cached: delivered + read. Not in `$fillable`.                                                                                                                                                                                                                                                                                                                                                                                        |
| read_count                                                                                     | uint default 0                                | Cached: read. Not in `$fillable`.                                                                                                                                                                                                                                                                                                                                                                                                    |
| clicked_count                                                                                  | uint default 0                                | Unique clicking contacts; incremented only by the link redirect. Not in `$fillable`.                                                                                                                                                                                                                                                                                                                                                 |
| fail_count                                                                                     | uint default 0                                | Cached: failed.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| created_at, updated_at                                                                         | timestamp null                                |                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| pinned, archived                                                                               | tinyint(1) default 0 (`archived` indexed)     | Mobile queue features only (MOB); the web UI never reads or writes them.                                                                                                                                                                                                                                                                                                                                                             |
| temp_caption, messages_log (json), template_type, temp_image, button_text, latitude, longitude | mobile queue content                          | Written only by the mobile app queue controller (MOB). `temp_caption` is the SMS runner's fallback body.                                                                                                                                                                                                                                                                                                                             |

Indexes: (user_id, status), user_id, template_id, status, scheduled_at, workspace_id, device_id, provider, archived. FK: workspace_id only. Port: composite FK `(workspace_id, template_id)`, RLS on workspace_id, add `(workspace_id, status, created_at)` index, drop encryption on name/timezone (or encrypt with app-level KMS if compliance requires), drop mobile-only columns from this table (separate `queues` table owned by MOB).

### `broadcast_contacts` (owned; one row per recipient per broadcast)

Purpose: recipient-level delivery state. No unique constraint on (broadcast_id, contact_id) (webhooks update by that pair). Row volume: total audience of all broadcasts (can reach millions). Read/written by TW-BCAST-015, -016, -025, -027, -030, -032 to -039.

| Column                         | Type / default                                   | Behavior                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                             | bigint PK                                        |                                                                                                                                                                                                                         |
| broadcast_id                   | bigint NOT NULL, FK broadcasts ON DELETE CASCADE |                                                                                                                                                                                                                         |
| contact_id                     | bigint NOT NULL, indexed, no FK                  | Contact. Rows survive contact deletion (shown as "Contact #id").                                                                                                                                                        |
| status                         | varchar(16) default `pending`, indexed           | `pending`, `sent`, `delivered`, `read`, `failed`; `processing` and `undelivered` are read by code but never written for broadcasts.                                                                                     |
| error_message                  | text null                                        | Provider/Node failure text (Meta code text, "Not on WhatsApp", "No phone number", attachment-missing:..., etc.). Model cast SafeEncrypted (decrypts ciphertext, passes plaintext through); raw writers store plaintext. |
| whatsapp_message_id            | varchar(255) null                                | Provider message id (wamid / Twilio SID / SMS id); key for receipts, billing and mirroring. Not indexed on this table (the WABA webhook looks it up here; port: index it).                                              |
| sent_at, delivered_at, read_at | timestamp null                                   | Set from callbacks (Node ISO strings parsed to `Y-m-d H:i:s`) or webhook time. No `failed_at` on this table (the shared scheduled table has one).                                                                       |
| created_at, updated_at         | timestamp null                                   | created = queued time shown on the recipients tab.                                                                                                                                                                      |

Indexes: (broadcast_id, status), contact_id, status. Port: composite FK `(workspace_id, broadcast_id)`, add `workspace_id`, index on `(workspace_id, whatsapp_message_id)`, add `failed_at`, `error_code`, and a unique `(broadcast_id, contact_id)`.

### `wa_link_clicks` (owned by this domain for the broadcast use; shared with campaigns)

Purpose: short-link registry and click counters for `/r/{token}`. Columns: id, token varchar(24) UNIQUE, original_url text, workspace_id/broadcast_id/campaign_id/message_id/contact_id/template_id (all nullable bigint; workspace, broadcast, campaign, message, contact and phone indexed), phone varchar(32) indexed, clicks uint default 0, unique_clicks uint default 0, first_click_at, last_click_at, last_ip varchar(45), last_user_agent varchar(191), expires_at timestamp null indexed, timestamps. No FKs. Volume: one row per (URL, recipient, send); large. Read/written by TW-BCAST-018, -032, -037, -042.

### Tables read but owned elsewhere

- `scheduled_message_contacts` (SCHED): read by broadcast id in the list tiles and detail page and written by the Meta status webhook branch; FK is to `scheduled_messages`, hence the id-collision quirk. Do not port this coupling.
- `contacts`, `contact_groups`, `tags`, `contact_tag` (CON): audience resolution; `contacts.is_unsubscribed` opt-out flag; `country_code`/`mobile`/`name`/`custom_attributes` are encrypted columns hydrated through Eloquent.
- `wa_templates` (TPL/WABA): template body, buttons, variable map, meta status, quality, paused_until, twilio_content_sid, attachments.
- `devices` (WADEV) and `wa_provider_configs` (WABA/Twilio/SMS): senders; `packages` (PLAN): `broadcast`, `broadcast_limit`, `broadcast_size_limit`, `sms_monthly_limit`, plus `telegram_broadcasts`, `line_broadcasts`, `wechat_broadcasts`, `viber_broadcasts` (channel domains); `workspaces.plan_overrides`; `system_settings`; `conversations`, `inbox_messages`, `workspace_ig_accounts` (TIB1/IG); notification and webhook tables (NOTIF/INTG).

## Cross-domain contracts

Consumes:

- `roles-permissions` / `workspaces-teams-tenancy`: `workspace.role:admin` gate (owner, admin), platform admin bypass, current workspace resolution (`forCurrentWorkspace`).
- `plans-subscriptions-trials`: `PlanLimitGuard::feature('broadcast')`, `::check('broadcast_limit')`, `sms_monthly_limit`, per-workspace `plan_overrides`, in-app paywall map `config/plan_gates.php` (`broadcasts`, `broadcasts/*` => `broadcast`).
- `whatsapp-devices-baileys` and `whatsapp-cloud-api-waba`: `WorkspaceEngine` (`enginesFor`, `senders`, `senderForKey`, default engine), device and provider-config rows, WABA credentials resolved per sender phone for Node, Meta template status fields, Meta status webhook (`applyStatus`), Twilio status controller, `TemplatePayloadBuilder`.
- `message-templates`: template model, `TemplateDataBuilder`, `TemplateOverrideResolver` (sanitize, lookup, apply), `x-template-live-mapping` component and `template-vars.js`, `WaTemplate::effectiveCategory()`.
- `contacts-attributes-tags`: contact/group/tag data, opt-out flag, attribute values for previews.
- `wallet-message-billing`: `SendGate::screenBody` (wallet precheck), `MessageBillingService::settleDelivered/settleFailed`.
- `scheduled-queue-warmer`: `WarmerService` (enabled, withinActiveHours, remainingFor, dailyBudgetFor, recordSendsFor, config gap).
- `node-bridge-runtime`: Node endpoints in TW-BCAST-021, heartbeat trigger for the sweeper, message-settings endpoint, `X-Node-Token` shared secret (`node_token()`), `tw_node_url()`.
- `team-inbox-conversations`: `InboxMirror::appendOutboundToOpenConversation`, `readableTemplateBody`.
- `integrations-hubspot-slack-trello-google-webhooks`: `WebhookService::emit/dispatch`.
- `notifications-activity-audit`: `LogsNotifications` trait / `NotificationHelper`; the Activity log page has a `broadcast` category label.
- `channel-sms` (SmsSender, SmsClient, SmsSegments), `channel-instagram` (InstaflowClient, IG accounts and conversations), `channel-telegram` (chooser target).
- `platform-settings-branding-storage`: `baileys_server_url`, `node_webhook_token`, pacing settings (`msg_gap`, `enable_batches`, `batches_gap`, `bw_msg_gap`), `waba_link_tracking_enabled`, `wa_link_tracking_ttl_days`, `broadcast_retry_*`, `waba_templates_v2_enabled`, `telegram_enabled`, `sms_enabled`.

Exposes:

- To `developer-rest-api-v1`: `BroadcastsController::store` (called internally with a synthetic request), `::statistics`, the `Broadcast` model and `broadcast_contacts`; `POST api/v1/broadcasts/{id}/stop` uses the Node cancel endpoint.
- To `mobile-app-api`: the `broadcasts` table as "queues" (extra columns `temp_caption`, `messages_log`, `pinned`, `archived`, ...), `broadcast_contacts` as queue members, `BroadcastsController` behaviours via `QueueController`, and Node's `cancel-by-broadcast` endpoint.
- To `scheduled-queue-warmer`: completed and completed_with_errors broadcasts (latest 50 by completed_at) as selectable "audience queues", and `broadcast_contacts` as their recipient snapshot.
- To `dashboards-analytics-charts` / `chat-conversations` (message history): dashboard counters (running/scheduled/paused/total from `broadcasts.status`, queued from unfinished broadcast rows), `UnifiedMessageStream` source "Broadcast" (one entry per `broadcast_contacts` row with the decrypted broadcast name), activity log category.
- To `campaigns`: `LinkTracker`, `wa_link_clicks`, `/r/{token}`, `RetryPolicy`, the Node pacing helpers.
- To `wallet-message-billing`: settle calls with source `broadcast`.
- To `install-update-licensing` / workspace wipe: `workspaces:wipe-expired` deletes `broadcast_contacts` then `broadcasts` for expired workspaces.
- Outbound webhook events: `broadcast_created`, `broadcast_status_updated`, `message_sent`, `message_delivered`, `message_read`, `message_failed`, `broadcast_message_status_updated`, `campaign_contact_clicked`.

## Open questions & quirks

QUIRK list (all confirmed from code unless noted; verify in live parity before deciding to preserve or fix):

1. **Scheduled broadcasts live only in Node memory** (TW-BCAST-021): a Node restart silently drops every scheduled broadcast; the Laravel row stays `scheduled` and nothing reconciles it. Also finished entries are never evicted from memory.
2. **Scheduled SMS broadcasts send immediately** (TW-BCAST-020): the SMS branch ignores the schedule.
3. **Chosen timezone is not applied to the send instant** (TW-BCAST-015): date and time are parsed in the app timezone. Docs claim otherwise. Confirm with a live test at `APP_TIMEZONE=UTC` and a non-UTC selection.
4. **`paused` status never persists** (TW-BCAST-022/026): Node pushes it, Laravel validation rejects it; a socket drop or daily-cap pause leaves the row `processing` and recipients `pending` with no resume path. No UI/API calls Node's pause/resume endpoints.
5. **List tiles Processing/Queued read `scheduled_message_contacts`** and are effectively always 0 for real broadcasts (TW-BCAST-002).
6. **Id-namespace collision with scheduled messages** (TW-BCAST-027/030): the shared recipient table is keyed by scheduled-message id yet interpreted as broadcast id in the detail page, tiles and the Meta status webhook recompute (can overwrite another broadcast's counters).
7. **Twilio status webhook does not recompute broadcast counters** (TW-BCAST-027): list/tiles lag while the detail rows are correct.
8. **Run-level callback overwrites cached counters** with the current run's numbers (0/0 at start, retry-subset numbers at the end) until a later recompute (TW-BCAST-026).
9. **Send-time overrides only take effect on the WABA prebuilt path and in the inbox mirror**; Baileys and Twilio ignore them though the UI offers them (TW-BCAST-017).
10. **Emergency send halt and content guardrails do not apply to broadcasts** (empty body passed to the gate, halt not checked) (TW-BCAST-011).
11. **`broadcast_size_limit` is configurable but never enforced** (TW-BCAST-041).
12. **Share weight 0 is treated as 1** although the UI allows 0 (TW-BCAST-014).
13. **Auto-retry sweeper** only runs from the Baileys heartbeat, can re-dispatch a broadcast that is still running, and retries permanent failures up to the cap; pending recipients are never swept (TW-BCAST-039).
14. **Manual retry has no status precondition** and ignores plan/wallet/warmer gates; returns ok even when the bridge call failed (TW-BCAST-038).
15. **Detail-page Delete submits a native form to a JSON endpoint**, leaving the user on a raw JSON response (TW-BCAST-040).
16. **Success flash says "sent" even if dispatch marked the row `failed`** (bridge down, no device) (TW-BCAST-015).
17. **Instagram broadcast creates no `broadcasts` row** (no history, retry or list entry), is synchronous and only checks the feature flag, not the row limit (TW-BCAST-019).
18. **Delivery curve is anchored at creation time** so scheduled broadcasts show an empty chart; labels have no date (TW-BCAST-031).
19. **Device label on the detail page** is looked up in `devices` even when `device_id` refers to a WABA/Twilio/SMS provider config (TW-BCAST-030).
20. **Possible duplicate inbox bubble** for immediate broadcasts to contacts with an open thread (two mirror triggers with different dedupe keys) (TW-BCAST-028).
21. **Billing may trigger on `sent`** for Baileys/Twilio via the Node callback, earlier than the delivery-time billing the wallet domain describes (TW-BCAST-025).
22. **Warmer reservation leaks** (not released on failure/delete) (TW-BCAST-013).
23. **Contact picker is capped at 500** newest contacts; group/tag expansion loads all workspace contacts in PHP (TW-BCAST-004, -010).
24. **Raw `{{token}}` can reach recipients on Baileys/Twilio** when a placeholder does not resolve (TW-BCAST-023).
25. **Notifications are noisy**: every non-quiet model update creates a bell entry (TW-BCAST-029).
26. **`send_time` unvalidated and past dates accepted** (TW-BCAST-008, -015).
27. **List loads all broadcasts of a workspace into memory** to filter by encrypted name (TW-BCAST-001).

Docs vs code (Documentation/pages/messaging/broadcasts.html):

- "Clicked tile with click-through rate": not rendered anywhere (TW-BCAST-042).
- "A template ... has fallen below your minimum quality setting is refused": no configurable minimum exists; only quality `RED` (plus not approved / paused) blocks, and only when `waba_templates_v2_enabled` is on and the template has a Meta id (TW-BCAST-012).
- "Daily cap (Unofficial API) 4000 / day / number" is presented as an admin pacing control: only Node has the key `baileys_daily_cap`; Laravel never sends it, so it is fixed at 4000 (TW-BCAST-022).
- "Status updates are de-duplicated": true for Meta/Twilio state machines; not for the Node per-recipient callback (TW-BCAST-025).
- "Scheduled sends carry the exact time and time zone so they always fire at the right local moment": see quirks 1 and 3.
- "Deleting first cancels any in-progress send": only a scheduled entry can be deleted; the cancel is best-effort.
- "Completed broadcasts ... can be re-used as a queue from Scheduled Messages": true (SCHED reads them).

Dead or unreachable code: `Broadcast::scopeForUser`, `::scopeWithStatus`, the `Broadcast::STATUSES` constant (used nowhere else), `BroadcastContact::contact()` relation, recipient statuses `processing` and `undelivered`, Node pause/resume/list/status/cancel-by-broadcast for the web flow, the sidebar "Recent broadcasts" links (`href="#"`), the `statistics` endpoint (no web caller), `$header['clicked']`/`clicked_pct` in `show()`.

Open questions:

- Should the port keep engine scoping of the list (`forCurrentEngine`) or show all rows? Currently rows of a disabled engine disappear and total tiles disagree with the list.
- Should mobile "queues" remain in the same table? Reference mixes them into the web list (they have provider/workspace and appear as broadcasts with no recipients state). Recommend a separate table owned by MOB.
- Is `waba_templates_v2_enabled` meant to stay optional? The prebuild logic already bypasses it for media/button/carousel templates.
- The doc lists Telegram, LINE, Viber, WeChat and Facebook broadcasts as siblings; only Telegram, SMS and Instagram are reachable from the chooser. Confirm menu entries for the others with the channel owners.
- Item ownership overlaps to reconcile at merge time: `LinkTracker`, `LinkRedirectController`, `wa_link_clicks` and `RetryPolicy` are shared with `campaigns`; `SmsBroadcastRunner` is shared with `channel-sms`; `resources/views/components/frontend/feature-broadcasts.blade.php` (marketing feature block) belongs to `marketing-site-cms`; `config/broadcasting.php`, `app/Broadcasting/PusherHttpBroadcaster.php` and the routes `GET|POST broadcasting/auth` and `POST api/app/broadcasting/auth` (Laravel realtime channel auth, unrelated to this feature despite the name) belong to `platform-infrastructure` / `mobile-app-api`; the `api/v1/broadcasts*` routes belong to `developer-rest-api-v1`; `Api/V1/BroadcastController`, `StoreBroadcastRequest`, `BroadcastResource` belong to `developer-rest-api-v1`; `Api/App/QueueController` belongs to `mobile-app-api`; the Facebook/LINE/Telegram/Viber/WeChat broadcast controllers, views and tables belong to their channel domains.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET broadcasts",
    "POST broadcasts",
    "GET broadcasts/create",
    "GET broadcasts/{id}",
    "DELETE broadcasts/{id}",
    "GET broadcasts/{id}/export",
    "GET broadcasts/{id}/live-stats",
    "POST broadcasts/{id}/retry-failed",
    "GET broadcasts/{id}/statistics",
    "POST api/update-broadcast-status",
    "POST api/update-message-status",
    "GET r/{token}"
  ],
  "controllers": [
    "app/Http/Controllers/BroadcastsController.php",
    "app/Http/Controllers/LinkRedirectController.php"
  ],
  "services": [
    "app/Services/BroadcastSweeper.php",
    "app/Services/Sms/SmsBroadcastRunner.php",
    "app/Services/Waba/LinkTracker.php",
    "app/Services/RetryPolicy.php"
  ],
  "models": ["Broadcast", "BroadcastContact", "WaLinkClick"],
  "tables": ["broadcasts", "broadcast_contacts", "wa_link_clicks"],
  "views": [
    "resources/views/user/broadcasts/_rows.blade.php",
    "resources/views/user/broadcasts/create.blade.php",
    "resources/views/user/broadcasts/index.blade.php",
    "resources/views/user/broadcasts/show.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": ["node/controllers/broadcastController.js", "node/services/broadcastService.js"],
  "js_assets": [
    "resources/js/charts/user-broadcasts-create.js",
    "resources/js/charts/user-broadcasts-index.js",
    "resources/js/charts/user-broadcasts-show.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": ["Documentation/pages/messaging/broadcasts.html"],
  "feature_map": {
    "TW-BCAST-001": ["GET broadcasts"],
    "TW-BCAST-002": [],
    "TW-BCAST-003": [],
    "TW-BCAST-004": ["GET broadcasts/create"],
    "TW-BCAST-005": [],
    "TW-BCAST-006": [],
    "TW-BCAST-007": [],
    "TW-BCAST-008": [],
    "TW-BCAST-009": ["POST broadcasts"],
    "TW-BCAST-010": [],
    "TW-BCAST-011": [],
    "TW-BCAST-012": [],
    "TW-BCAST-013": [],
    "TW-BCAST-014": [],
    "TW-BCAST-015": [],
    "TW-BCAST-016": [],
    "TW-BCAST-017": [],
    "TW-BCAST-018": ["GET r/{token}"],
    "TW-BCAST-019": [],
    "TW-BCAST-020": [],
    "TW-BCAST-021": [],
    "TW-BCAST-022": [],
    "TW-BCAST-023": [],
    "TW-BCAST-024": [],
    "TW-BCAST-025": ["POST api/update-message-status"],
    "TW-BCAST-026": ["POST api/update-broadcast-status"],
    "TW-BCAST-027": [],
    "TW-BCAST-028": [],
    "TW-BCAST-029": [],
    "TW-BCAST-030": ["GET broadcasts/{id}"],
    "TW-BCAST-031": [],
    "TW-BCAST-032": [],
    "TW-BCAST-033": [],
    "TW-BCAST-034": [],
    "TW-BCAST-035": ["GET broadcasts/{id}/live-stats"],
    "TW-BCAST-036": ["GET broadcasts/{id}/statistics"],
    "TW-BCAST-037": ["GET broadcasts/{id}/export"],
    "TW-BCAST-038": ["POST broadcasts/{id}/retry-failed"],
    "TW-BCAST-039": [],
    "TW-BCAST-040": ["DELETE broadcasts/{id}"],
    "TW-BCAST-041": [],
    "TW-BCAST-042": [],
    "TW-BCAST-043": []
  }
}
```
