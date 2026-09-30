---
domain: auto-reply-keywords
code: AR
title: Auto-reply and keyword rules
wadesk_version: '1.7.0'
sources_read: 62
---

# Auto-reply and keyword rules

## Overview

Auto Reply is WaDesk's rule-based responder. A workspace admin defines **rules** ("keyword replies"); when an inbound customer message arrives on a connected sender, WaDesk picks at most one rule and answers automatically with a text, media, template, contact card, catalog link, location prompt, or by starting a flow. Since 2026-07 the same table also holds keyword-less **auto-responder** rules: a Welcome Message (first message of a new conversation), an Away message (while a manual workspace switch is on), an Out-of-hours message (outside a rule's own schedule), and an "Any message" default route that runs only after every keyword has failed. Instagram rules additionally carry one of five Instagram-native triggers (DM keyword, comment-to-DM, story reply, story mention, mention).

Who uses it: workspace owners/admins (the page is `workspace.role:admin`; platform admins bypass), and indirectly every end customer who messages a connected number. The main flow: admin opens `/auto-reply` (list, stats, top performers, filters, bulk actions, CSV import), builds a rule in a 5-step wizard at `/auto-reply/create` (Trigger, Schedule, Reply type, Compose, Review), and the rule is stored one row per selected sender. At runtime there are **two independent execution paths** that must behave identically but do not fully do so:

1. **Unofficial/Baileys path.** The Node bridge calls the public-looking but token-guarded `GET /api/keyword-replies` on every inbound. Laravel resolves the device and workspace, runs the welcome, away and out-of-hours passes, then the keyword race (SQL candidate filter, exact/contains/regex/fuzzy, stored translations, live translation, fuzzy, media-order fallback, default route), checks flow liveness and plan billing, bumps counters, writes a fire log, and returns a JSON payload. Node then applies the per-customer cooldown, the reply delay, and sends the reply itself.
2. **Every other engine and channel** (WABA Cloud, Twilio, Instagram, Facebook, Telegram, LINE, WeChat, Viber, SMS, TikTok, Email). The channel webhook calls `KeywordReplyDispatcher::maybeDispatch` after routing rules and after the flow bridge. It runs the same passes (minus translation, fuzzy fallback and the default route) and ships the reply through `InboxDispatcher`.

A per-rule analytics page (`/auto-reply/keyword`) shows fires, heatmap, funnel and latency from two log tables. Plan tiers: the package flag `access_keyword_replies` gates every mutation (list/create/analytics pages still render behind a soft paywall overlay from `config/plan_gates.php`), and `autoreply_limit` caps the number of rules (0 or null = unlimited). Connections: WADEV/WABA/NODE (senders, Node bridge), FLB/FLR (flow-type replies, flow-managed keyword rules), TIB1/TIB2 (conversations, routing_meta, AutoReplyGuard), I18N (translation engine, language detector, backfill command), WALLET (send billing), CON (contact placeholders and groups for exclusion), TPL (template replies), CAT (catalog replies), IG/FB/TG/LINE/WECH/VIB/SMS/TT/MAIL (channel webhooks that call the dispatcher), API and MOB (their `auto-replies` endpoints reuse these tables), ASHELL (the /more card counters).

The seeded reference database contains no rules (0 rows in all four tables), so all behavior below comes from code reading; nothing was observed live.

## Feature index

| Id        | Feature                                                                                       | Status      | Priority | Effort | Depends on           |
| --------- | --------------------------------------------------------------------------------------------- | ----------- | -------- | ------ | -------------------- |
| WD-AR-001 | Rule manager page: list, KPI strip, top performers                                            | implemented | P0       | M      | WD-AR-010            |
| WD-AR-002 | List search, filters, pagination, list/grid toggle, partial refresh                           | implemented | P1       | M      | WD-AR-001            |
| WD-AR-003 | Manual Away mode switch                                                                       | implemented | P1       | S      | WD-AR-016            |
| WD-AR-004 | Toggle a rule active or paused                                                                | implemented | P0       | S      | WD-AR-001            |
| WD-AR-005 | Bulk activate, pause and delete                                                               | implemented | P1       | S      | WD-AR-001            |
| WD-AR-006 | Delete a rule and its uploaded media                                                          | implemented | P0       | S      | WD-AR-001            |
| WD-AR-007 | CSV import of rules                                                                           | implemented | P1       | M      | WD-AR-010            |
| WD-AR-008 | Demo CSV download                                                                             | implemented | P2       | S      | WD-AR-007            |
| WD-AR-009 | Create/edit wizard shell, stepper, review and edit hydration                                  | implemented | P0       | L      | WD-AR-010, WD-AR-012 |
| WD-AR-010 | Create rule endpoint: validation, gates, ownership, transaction                               | implemented | P0       | M      | WD-AR-029            |
| WD-AR-011 | Sender selection, engine stamping and multi-sender fan-out                                    | implemented | P0       | M      | WD-AR-010            |
| WD-AR-012 | Update rule endpoint: partial updates, sibling fan-out, content replacement                   | implemented | P0       | M      | WD-AR-010            |
| WD-AR-013 | Keyword trigger: keyword list, match methods, similarity, regex                               | implemented | P0       | M      | WD-AR-010            |
| WD-AR-014 | Any-message default route (catch-all)                                                         | implemented | P1       | S      | WD-AR-013            |
| WD-AR-015 | Welcome Message trigger                                                                       | implemented | P1       | M      | WD-AR-035            |
| WD-AR-016 | Away trigger                                                                                  | implemented | P1       | S      | WD-AR-035            |
| WD-AR-017 | Out-of-hours trigger (no UI, legacy)                                                          | partial     | P2       | S      | WD-AR-035            |
| WD-AR-018 | Rule priority                                                                                 | partial     | P2       | S      | WD-AR-015            |
| WD-AR-019 | Cooldown and reply delay (Schedule step)                                                      | implemented | P1       | S      | WD-AR-038            |
| WD-AR-020 | Resend window and agent override settings                                                     | implemented | P1       | S      | WD-AR-035            |
| WD-AR-021 | Rule working hours and outside-hours message                                                  | implemented | P1       | M      | WD-AR-035            |
| WD-AR-022 | Excluded recipients (numbers and contact groups)                                              | implemented | P2       | S      | WD-AR-035            |
| WD-AR-023 | Custom reply composer: text, image, document, video, template                                 | implemented | P0       | L      | WD-AR-010            |
| WD-AR-024 | Reply type: run a flow                                                                        | implemented | P0       | S      | WD-AR-042            |
| WD-AR-025 | Reply type: share a contact card                                                              | implemented | P2       | S      | WD-AR-010            |
| WD-AR-026 | Reply type: send a catalog                                                                    | partial     | P2       | S      | WD-AR-010            |
| WD-AR-027 | Reply type: request location                                                                  | implemented | P2       | S      | WD-AR-010            |
| WD-AR-028 | Instagram-native triggers                                                                     | implemented | P1       | M      | WD-AR-039            |
| WD-AR-029 | Plan feature flag, rule cap, role gate and paywall overlay                                    | implemented | P0       | S      | none                 |
| WD-AR-030 | Bot lookup endpoint: token auth, request contract, device and workspace resolution, audit row | implemented | P0       | L      | WD-AR-029            |
| WD-AR-031 | Keyword matching semantics: candidate query, exact, contains, fuzzy, regex                    | implemented | P0       | M      | WD-AR-013            |
| WD-AR-032 | Lookup resolution order and tie-breaking                                                      | implemented | P0       | M      | WD-AR-030, WD-AR-031 |
| WD-AR-033 | Multilingual fallback and reply-language selection                                            | implemented | P1       | L      | WD-AR-032            |
| WD-AR-034 | Baileys auto-responder passes: welcome, away, out-of-hours, orphan self-heal                  | implemented | P1       | M      | WD-AR-035            |
| WD-AR-035 | Auto-responder gate evaluator                                                                 | implemented | P1       | M      | none                 |
| WD-AR-036 | Lookup post-match: flow liveness, billing check, counters, fire log                           | implemented | P0       | M      | WD-AR-032            |
| WD-AR-037 | Lookup reply payloads and placeholder resolution                                              | implemented | P0       | M      | WD-AR-036            |
| WD-AR-038 | Node bridge consumption: cooldown, delay, send, inbox mirror                                  | implemented | P0       | M      | WD-AR-037            |
| WD-AR-039 | Dispatcher path for WABA, Twilio and channel bridges                                          | implemented | P0       | L      | WD-AR-035, WD-AR-031 |
| WD-AR-040 | Dispatcher reply builders: all reply types, delay, flow enrolment                             | implemented | P0       | M      | WD-AR-039            |
| WD-AR-041 | Conversation-level auto-reply guard                                                           | partial     | P2       | S      | WD-AR-039            |
| WD-AR-042 | Flow-managed keyword rules (flow trigger sync)                                                | implemented | P0       | M      | WD-AR-032            |
| WD-AR-043 | Per-rule keyword analytics page                                                               | partial     | P1       | M      | WD-AR-036            |
| WD-AR-044 | Keyword pre-translation service and backfill command                                          | partial     | P2       | M      | WD-AR-033            |

## Features

### WD-AR-001 — Rule manager page: list, KPI strip, top performers

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-010
- **Summary:** The landing page of the domain. It shows every rule the workspace can manage, four KPI cards, a "top performers" panel, the Away-mode pill, Import and New buttons, and the filterable table/grid (see WD-AR-002). It is the single place a workspace admin sees what auto-replies exist and how much they fire.
- **Actors & access:** Workspace admin or owner (`workspace.role:admin`; agents and viewers are redirected to `/team-inbox` with a warning flash, managers get 403; platform admins bypass). No permission key and no plan check on the GET itself: when the package flag `access_keyword_replies` is off the page renders but the shared paywall component slides an upgrade sheet over it (URL glob `auto-reply` and `auto-reply/*` in `config/plan_gates.php`). Workspace scoped through `users.current_workspace_id`.
- **UX & screens:** `resources/views/user/auto-reply/index.blade.php` in the user layout (nav key `more`, JS page module `user-auto-reply-index`).
  - Header: back arrow to `/more`, breadcrumb "More / Auto Reply", a green pill "N active rules", the Away toggle pill (WD-AR-003), an Import button (opens the import modal, WD-AR-007) and a "New auto reply" link to `/auto-reply/create`.
  - KPI strip (4 cards): Active (with "N paused" and "/ total"), Total triggered (all-time sum of `trigger_count`, labelled "replies sent"), Fired (24h) (number of rules whose `last_triggered_at` is within 24h, with "% of active"), Devices (count of active Baileys `devices` rows of the workspace, labelled "connected"; singular/plural "sender(s)").
  - "Top performers" card: up to 4 active rules ordered by `trigger_count` descending, each row a link to `/auto-reply/create?id=<id>` with a numbered tile, keyword, a bar scaled to the max, and the count. Empty state: "Nothing fired yet..." . The card subtitle says "this week" but the data is all-time (QUIRK). A link "Open analytics" goes to `/analytics`.
  - A static tip card "Stack 3 keywords per rule" with a "Build a rule" button.
  - Below: the filter bar and list/grid (WD-AR-002), pagination, and a footer "Showing X of Y filtered auto replies" (hidden when zero).
  - Row/card details: two-letter tile from the first two characters of the keyword, keyword (line-clamped), a provider badge (Unofficial API, WABA, Twilio, Instagram; none for other providers), match sub-label (`fuzzy / NN%`, `contains`, otherwise `exact`; regex and welcome rules also read "exact"), device cell (phone plus name), type pill (`Flow / <flow name>` or `Custom / Text|Image|Video|Document|Template`, based on `message_type`; share_contact, send_catalog and request_location rules all render as "Custom / Text"), trigger count with "last N ago", status switch, and actions (view analytics, edit, delete). Grid cards add the first 2 lines of the first selected reply text and "Updated N ago".
  - Device cell resolution: `devices` relation first; else the rule's `device_id` is looked up in `wa_provider_configs` (phone plus display label or provider); else for provider `instagram` the `workspace_ig_accounts` row with `instaflow_account_id = device_id` (shows `@username` and name). Facebook/Telegram/LINE/etc. rules show "-" (QUIRK, no resolver).
  - Empty state (no rows after filters): "No auto-reply rules match the current filters. Try clearing filters or create a new auto reply." with reset-filters and create buttons.
- **Endpoints:**

| Method uri     | Route name            | Action                    | Middleware                      | Request                                                          | Response                                                           |
| -------------- | --------------------- | ------------------------- | ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| GET auto-reply | user.auto-reply.index | AutoReplyController@index | web, auth, workspace.role:admin | query `q`, `device`, `status`, `type`, `view`, `page`, `partial` | HTML page; JSON when `Accept: json` or `partial=1` (see WD-AR-002) |

- **Data:** Reads `keyword_replies` via scope `forListing(workspaceId)` (see rule 1) ordered `created_at` desc, hard limit 500 rows, with eager relations `device` (id, phone_number, device_name), `selectedContents`, `flow` (id, flow_name). Reads `devices` (workspace, `active=1`). Reads `workspaces.inbox_away`. Also runs a diagnostic `[AUTOREPLY-INDEX]` log line per request (do not port).
- **Rules & edge cases:**
  1. `forListing` scope: rows of the workspace whose `provider` is in the workspace's enabled WhatsApp engines (`WorkspaceEngine::enginesFor`: baileys, waba, twilio) plus `instagram` when a workspace IG account is connected, plus `facebook` when system setting `facebook_enabled` is on and a Page is connected, plus `telegram` (setting `telegram_enabled` + a bot), plus `email` (setting `email_enabled` + a mailbox); rows with NULL or empty provider are always included. LINE, WeChat, Viber, SMS and TikTok providers are NOT in the scope, so rules stamped with them are invisible on this page (QUIRK). The `/more` dashboard card uses the same scope so counts agree.
  2. Only the newest 500 rules are loaded; stats and pagination are computed in memory over those, so a workspace with more than 500 rules gets truncated stats and cannot see older rules (QUIRK).
  3. Stats: total = loaded count; active/inactive by `status`; total_triggers = sum of `trigger_count`; rules_fired_24h = count of rules with `last_triggered_at >= now-24h`.
  4. Managed flow-trigger rules (`is_flow_trigger = 1`, see WD-AR-042) are listed like hand-made rules and can be toggled or deleted; the next flow save recreates them and resets their status (QUIRK).
  5. Welcome, away and default-route rules have no match pattern; their `keyword` column stores the operator's rule name (or blank for flow-managed catch-all), so the list shows that name (or "-").
  6. `awayMode` passed to the view is `workspaces.inbox_away`.
  7. Soft-deleted rules are excluded (Eloquent soft deletes).
- **Async & events:** None. Purely a read.
- **External systems:** None.
- **Settings:** System settings `facebook_enabled`, `telegram_enabled`, `email_enabled` widen the listing scope; workspace engine settings define `enginesFor`.
- **Acceptance criteria:**
  - Given a workspace with 5 active and 2 paused rules, when an admin opens `/auto-reply`, then the Active card reads 5 with "2 paused" and "/ 7 total".
  - Given rules with trigger counts 30, 20, 10, 5, 1, when the page loads, then Top performers lists the top 4 active rules in that order with proportional bars.
  - Given a workspace with no rules, when the page loads, then KPI cards show zeros, Top performers shows the empty message, and the table shows the empty state with a Create button.
  - Given an agent-role user, when they request `/auto-reply`, then they are redirected to `/team-inbox` with a role warning.
  - Given the plan flag `access_keyword_replies` is off, when an admin opens the page, then it renders with the upgrade overlay and every write action fails (WD-AR-029).
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (index), `resources/views/user/auto-reply/index.blade.php`, `resources/views/user/auto-reply/_rows.blade.php`, `resources/views/user/auto-reply/_grid.blade.php`, `resources/js/charts/user-auto-reply-index.js`, `app/Models/KeywordReply.php` (scopeForListing), `config/plan_gates.php`, `app/Http/Middleware/EnsureWorkspaceRole.php`, `Documentation/pages/messaging/auto-reply.html`.
- **Port notes:** No `auto_reply` module exists in this repo (`apps/api/src/modules` has admin, auth, billing, broadcast, crm, exams, identity, inbox, partner, public-api; `inbox` is README-only). Suggested home `apps/api/src/modules/inbox/auto-reply/` (or a new `automation` module) plus `apps/web/.../auto-reply`. Do not load 500 rows and filter in memory; use SQL filters plus cursor pagination. Compute stats with aggregate queries. Replace the provider allow-list scope with a single `channel_accounts` join so all channels are visible. RLS: `keyword_replies.workspace_id` is already the tenant key.

### WD-AR-002 — List search, filters, pagination, list/grid toggle, partial refresh

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AR-001
- **Summary:** The list can be searched, filtered by device, status and reply type, paged 12 per page, and shown as a table or a card grid. Every interaction re-fetches server-rendered fragments as JSON without a full page load and keeps the URL in sync.
- **Actors & access:** Same as WD-AR-001.
- **UX & screens:** Filter bar in `index.blade.php`: search input (placeholder "Search by keyword, device, or reply text..." , debounced 220 ms), device select ("All devices" plus each active device as `phone / name`), status select (All status, Active, Paused), type select (All reply types, Custom message, Flow, Text, Template, Image, Video, Document), and a two-button list/grid toggle. Pagination uses the shared `user.partials.pagination` partial with `data-ar-page` links and the label "auto replies". A bulk bar appears above the table when rows are ticked (WD-AR-005). Loading state: list, grid and pager fade to 60% opacity while fetching. Errors: a toast "Could not refresh auto replies: <message>". Browser back/forward restores state from the query string (`popstate`). The view toggle only changes the client and the URL (`view=grid`), it does not refetch.
- **Endpoints:**

| Method uri               | Route name            | Action                    | Middleware                      | Request                                                                         | Response                                                                                                                                    |
| ------------------------ | --------------------- | ------------------------- | ------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET auto-reply?partial=1 | user.auto-reply.index | AutoReplyController@index | web, auth, workspace.role:admin | `q`, `device`, `status` (all/active/paused), `type`, `view` (list/grid), `page` | JSON `{ok, rows(html), grid(html), pagination(html), shown, total, page, totals{total, active, inactive, total_triggers, rules_fired_24h}}` |

- **Data:** Operates on the 500-row in-memory collection from WD-AR-001. Ordering is fixed `created_at` desc; there is no sort control.
- **Rules & edge cases:**
  1. Search is case-insensitive substring over: keyword, device phone plus device name (only the `devices` relation, not WABA/IG fallbacks), and the concatenated decrypted text of all selected content variants (`keyword_reply_contents.content` is encrypted at rest, so this decrypts in memory).
  2. `device` filter compares `device_id` to the integer id regardless of engine, so ids from different channel tables can collide (QUIRK). The dropdown only lists Baileys `devices`, so WABA/IG/other-channel rules cannot be filtered by sender.
  3. `status`: `active` keeps `status = true`, `paused` keeps false, anything else means all.
  4. `type`: `custom` and `flow` filter on `reply_type`; `text|image|video|document|template` filter on `message_type` (this also matches flow rows whose stored `message_type` is `text`); other values (including reply types share_contact, send_catalog, request_location) are ignored and return all rows.
  5. Page size is 12; `page` is clamped to the valid range; the JSON `totals` reflect all loaded rules, not the filtered subset, while `total` and `shown` reflect the filtered set.
  6. The URL is rebuilt omitting defaults (`all`, `list`, page 1).
  7. A JSON response is returned when the request `wantsJson()` or `partial=1`.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given 30 rules, when the list loads, then 12 are shown with a pager of 3 pages and the footer reads "Showing 12 of 30".
  - Given a rule whose reply text contains "invoice", when the admin types "invoice" in search, then the rule appears within about 300 ms and the URL contains `q=invoice`.
  - Given the status filter is Paused, when the admin ticks Activate on a row, then the row disappears after the refresh.
  - Given filters are set, when the admin clicks "reset" in the empty state, then all filters return to All and page 1 loads.
  - Given `?partial=1`, when requested, then the response is JSON with the rendered row, grid and pager fragments.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (index, paginateCollection in `app/Http/Controllers/Controller.php`), `resources/js/charts/user-auto-reply-index.js`, `resources/views/user/auto-reply/_rows.blade.php`, `resources/views/user/auto-reply/_grid.blade.php`.
- **Port notes:** Implement filters and search in SQL; encrypted content search is not possible in SQL, so either store a searchable plain excerpt/tsvector per variant or drop content search. Return JSON data, not HTML fragments; the Next.js page renders itself. Keep query-string state.

### WD-AR-003 — Manual Away mode switch

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AR-016
- **Summary:** A header pill on the rule manager flips a workspace-wide "Away mode". While it is on, every `away` trigger rule answers the next inbound (subject to its own resend window, exclusions and agent-override) like a WhatsApp Business away message.
- **Actors & access:** Workspace admin/owner. Plan flag `access_keyword_replies` is enforced (throws when off). No audit entry.
- **UX & screens:** In the index header, a form-post pill: "Away on" (amber) or "Away off" (grey) with a small switch graphic and a tooltip explaining the behavior. Clicking submits a normal form POST with hidden `away` = 0 or 1; the page redirects back with a flash "Away mode is ON - away auto-replies will fire until you switch it off." or "Away mode is OFF.". There is no live JSON usage in the UI, but JSON callers get `{ok, away}`.
- **Endpoints:**

| Method uri                | Route name                | Action                         | Middleware                      | Request                                           | Response                                                                        |
| ------------------------- | ------------------------- | ------------------------------ | ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| POST auto-reply/away-mode | user.auto-reply.away-mode | AutoReplyController@toggleAway | web, auth, workspace.role:admin | `away` boolean (optional; omitted = flip current) | JSON `{ok, away}` when expectsJson/ajax, else redirect back with `status` flash |

- **Data:** Writes `workspaces.inbox_away` (tinyint, default 0). Read at runtime by `AutoResponderEvaluator::isWorkspaceAway` (one query per inbound).
- **Rules & edge cases:**
  1. 404 if the user has no current workspace.
  2. The flag is per workspace, not per sender or per rule; there is no schedule or auto-off.
  3. Turning it on does nothing unless at least one active `away` rule exists (WD-AR-016).
  4. Also consumed by the Flow builder's `away` inbound-condition trigger through `FlowEnrollmentService::onInboundMessage` (FLR).
- **Async & events:** None (no broadcast, no notification).
- **External systems:** None.
- **Settings:** `workspaces.inbox_away`.
- **Acceptance criteria:**
  - Given away is off, when the admin clicks the pill, then `inbox_away` becomes 1, the pill turns amber "Away on", and the flash confirms.
  - Given away is on and an active away rule exists, when a customer messages, then the away reply is sent once per resend window.
  - Given the plan flag is off, when the pill is clicked, then the request is rejected with the plan-limit error.
  - Given an agent-role user posts to the route, then they are redirected to `/team-inbox`.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (toggleAway), `app/Services/Inbox/AutoResponderEvaluator.php` (isWorkspaceAway), `database/migrations/2026_07_31_020000_add_autoresponder_away_outofhours.php`, `resources/views/user/auto-reply/index.blade.php`.
- **Port notes:** Column lives on `workspaces` (owned by WSP). Expose as `PUT /auto-reply/away-mode`; emit an audit entry (WaDesk does not). Consider an optional auto-off time.

### WD-AR-004 — Toggle a rule active or paused

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AR-001
- **Summary:** A switch on each row (and a Pause/Resume button on the analytics page) flips `status`. A paused rule never fires but is kept.
- **Actors & access:** Workspace admin/owner; plan flag `access_keyword_replies` enforced.
- **UX & screens:** Status switch in list and grid; on change the label flips immediately, the switch is disabled during the request, a toast "Auto reply activated." or "Auto reply paused." appears, and the list refreshes. On failure the switch reverts and a toast "Toggle failed: <message>" shows. On the analytics page the header button "Pause rule"/"Resume rule" posts the same endpoint and reloads.
- **Endpoints:**

| Method uri                  | Route name             | Action                     | Middleware                                  | Request | Response            |
| --------------------------- | ---------------------- | -------------------------- | ------------------------------------------- | ------- | ------------------- |
| POST auto-reply/{id}/toggle | user.auto-reply.toggle | AutoReplyController@toggle | web, auth, workspace.role:admin; id numeric | none    | JSON `{ok, status}` |

- **Data:** Flips `keyword_replies.status` (boolean). 404 when the id is not in the workspace.
- **Rules & edge cases:**
  1. Ownership uses `forWorkspace(wsId)`; when `current_workspace_id` is empty the scope returns all rows (QUIRK: a platform admin with no workspace could toggle any tenant's rule).
  2. The plan feature check runs before the lookup.
  3. The toggle is a read-modify-write (no lock); rapid double clicks can race.
  4. Flow-managed rules are overwritten by the next flow save.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an active rule, when toggled, then `status` is false and inbound matching skips it.
  - Given a paused rule, when toggled, then it matches again on the next inbound.
  - Given a rule id from another workspace, when toggled, then the response is 404.
  - Given a network error, when the switch is clicked, then the UI reverts and shows an error toast.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (toggle), `resources/js/charts/user-auto-reply-index.js`, `resources/js/charts/user-auto-reply-keyword.js`.
- **Port notes:** Prefer explicit `PUT {enabled}` over flip to be idempotent. Add optimistic version or use `UPDATE ... SET status = NOT status RETURNING`.

### WD-AR-005 — Bulk activate, pause and delete

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AR-001
- **Summary:** Admins can tick several rows (or the header checkbox) and activate, pause or delete them in one action.
- **Actors & access:** Workspace admin/owner; plan flag enforced.
- **UX & screens:** Row checkboxes and a header select-all (with indeterminate state) in the table view only; a bulk bar shows "N selected" with Activate, Pause, Delete and a clear (x) button. Each action asks a confirm dialog: title "<Verb> N auto-replies?"; delete adds "This deletes the selected auto-reply rules and any uploaded attachments. Cannot be undone.". Success toast "<n> auto-replies <action>d." then the list refreshes with the URL's state. Selection spans only the current page (checkboxes are re-created on each refresh).
- **Endpoints:**

| Method uri           | Route name           | Action                   | Middleware                      | Request                                                                 | Response             |
| -------------------- | -------------------- | ------------------------ | ------------------------------- | ----------------------------------------------------------------------- | -------------------- |
| POST auto-reply/bulk | user.auto-reply.bulk | AutoReplyController@bulk | web, auth, workspace.role:admin | `ids` array min 1 of integers, `action` in delete, activate, deactivate | JSON `{ok, touched}` |

- **Data:** For delete: physically deletes each rule's uploaded files, hard-deletes its `keyword_reply_contents`, soft-deletes the `keyword_replies` row. For activate/deactivate: sets `status`. Ids not in the workspace are silently ignored; `touched` = rows found.
- **Rules & edge cases:**
  1. Not transactional; a failure midway leaves earlier rows changed.
  2. Logs (`keyword_reply_logs`) and lookups referencing deleted rules are kept.
  3. The toast text is built client-side by appending "d" to the raw action word ("activated", "deactivated", "deleted"), so a Pause shows "deactivated".
  4. Header "select all" only affects visible rows.
- **Async & events:** None.
- **External systems:** Object storage delete for each media file (active media disk).
- **Settings:** None.
- **Acceptance criteria:**
  - Given 3 ticked rules, when Pause is confirmed, then all 3 have `status = false` and `touched = 3`.
  - Given a mix of own and foreign ids, when Delete is confirmed, then only own rules are removed and `touched` counts them.
  - Given no rows are ticked, then the bulk bar is hidden.
  - Given an empty `ids` array, when posted, then validation fails with 422.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (bulk, deleteContentFiles), `resources/js/charts/user-auto-reply-index.js`, `resources/views/user/auto-reply/index.blade.php`.
- **Port notes:** Wrap in a transaction; queue file deletion as a worker job after commit (object storage). Consider a cap on ids per request.

### WD-AR-006 — Delete a rule and its uploaded media

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AR-001
- **Summary:** A trash icon on each row deletes the rule after confirmation; its content variants and uploaded files go with it.
- **Actors & access:** Workspace admin/owner; plan flag enforced (so a downgraded workspace cannot delete rules either).
- **UX & screens:** Confirm dialog "Delete auto reply?" with message `Delete "<keyword>"? This cannot be undone.`; confirm text Delete; on error toast "Delete failed: <message>". List refreshes on success. Grid cards have the same button.
- **Endpoints:**

| Method uri             | Route name              | Action                      | Middleware                                  | Request | Response          |
| ---------------------- | ----------------------- | --------------------------- | ------------------------------------------- | ------- | ----------------- |
| DELETE auto-reply/{id} | user.auto-reply.destroy | AutoReplyController@destroy | web, auth, workspace.role:admin; id numeric | none    | JSON `{ok: true}` |

- **Data:** Removes files for each `keyword_reply_contents` row with a `file_path` (legacy `uploads/...` paths under `public/`; new bare paths on the active media disk, local or Cloudflare R2), hard-deletes the content rows, soft-deletes the rule (`deleted_at`). Sibling rows created by multi-sender fan-out are independent and are not deleted.
- **Rules & edge cases:**
  1. Soft delete but contents are hard-deleted, so a "restore" is impossible in practice.
  2. Outside-hours variants are also deleted (same content table).
  3. 404 if not in workspace; same empty-workspace scope quirk as WD-AR-004.
  4. A flow-managed rule (`is_flow_trigger`) can be deleted here; the next save of that flow recreates it.
  5. Deleting the linked flow force-deletes managed rules (WD-AR-042); hand-made flow-type rules that point at a deleted flow stay and fail closed at runtime (flow liveness check, WD-AR-036).
- **Async & events:** File deletions are synchronous inline.
- **External systems:** Media storage (local disk or R2) delete; failures are swallowed.
- **Settings:** `media_disk()` setting selects local or cloud.
- **Acceptance criteria:**
  - Given a rule with an image variant, when deleted, then the file no longer exists on the media disk and the rule disappears from the list.
  - Given a rule of another workspace, when deleted by id, then 404.
  - Given a downgraded plan with the feature off, when deleting, then the plan-limit error is returned.
  - Given fan-out siblings on 3 senders, when one is deleted, then the other two remain.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (destroy, deleteContentFiles), `resources/js/charts/user-auto-reply-index.js`.
- **Port notes:** Hard-delete rules (or keep soft delete but also keep contents) and queue blob deletion post-commit. Files in this repo would go through the (not yet built) file-storage module; do not store bare paths that depend on a disk setting.

### WD-AR-007 — CSV import of rules

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AR-010
- **Summary:** Admins upload a CSV (or .txt) of up to 5 MB to create or update many keyword rules at once. Each row is matched to a sender by id or phone and is upserted by (workspace, sender, keyword).
- **Actors & access:** Workspace admin/owner; plan flag `access_keyword_replies` enforced. The numeric `autoreply_limit` is NOT enforced (QUIRK).
- **UX & screens:** Import modal on the index page (`#ar-import-modal`): title "Upload auto replies from CSV", a dashed file tile ("Choose CSV file", "CSV / max 5 MB", Browse), an "Expected columns" box (keyword required, reply_text required for custom, device_id optional, status active/paused) with a "Download demo CSV" link (WD-AR-008), a helper paragraph (blank device_id uses the first active device; optional columns matching_method, fuzzy_similarity, reply_type, message_type, cooldown, timeout, flow_id, template_id), and Cancel/Upload buttons. Upload posts via fetch; success toast is the server message, the modal closes, the list reloads to page 1; failure toast "Import failed: <message>". Non-JS submit redirects to the list with a flash.
- **Endpoints:**

| Method uri             | Route name             | Action                     | Middleware                      | Request                                                                                                                                                           | Response                                                                        |
| ---------------------- | ---------------------- | -------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| POST auto-reply/import | user.auto-reply.import | AutoReplyController@import | web, auth, workspace.role:admin | multipart `file`: required, file, max 5120 KB, mimes csv,txt, mimetypes text/csv, text/plain, application/csv, application/vnd.ms-excel, application/octet-stream | JSON `{ok, message, imported, skipped}` (422 on failure) or redirect with flash |

- **Data:** Upserts `keyword_replies` with `updateOrCreate` keyed on (`workspace_id`, `device_id`, `keyword`), then for custom rows replaces `keyword_reply_contents` with a single row (`content_type` = message type, `content`, `template_id` only for template type, `is_selected` true, `sort_order` 0); for non-custom rows deletes all contents (and their files). All in one DB transaction per row.
- **Rules & edge cases:**
  1. Header normalisation: strip BOM, lowercase, replace non-alphanumerics with underscores. Aliases: keyword = keyword, keywords, trigger, trigger_keyword; matching_method = matching_method, match, match_type; fuzzy_similarity = fuzzy_similarity, similarity; device = device_id, sender_id, or phone via device_phone, phone_number, sender_phone; reply_type = reply_type, type; message_type = message_type, content_type; content = reply_text, message, content, body; status = status, active, enabled; plus template_id, flow_id, cooldown, timeout.
  2. Fully blank rows are ignored silently (not counted as skipped).
  3. Skipped (counted) when: keyword empty; reply_type is flow and flow_id missing or not in a flow owned by a workspace member (`flows.user_id` in members); reply_type is custom, content empty and message_type is not template.
  4. Defaults: matching_method invalid or blank becomes exact (regex is allowed but not validated); fuzzy_similarity blank becomes 80, clamped 0..100; reply_type invalid becomes custom; message_type invalid becomes text; status parsed from 1/true/yes/y/on/active/enabled versus 0/false/no/n/off/paused/inactive/disabled, default true; cooldown/timeout not clamped (blank = null).
  5. Sender resolution: `device_id` must be in the workspace's active Baileys devices; else phone digits matched against `devices.phone_number` digits; else the first active device. If the workspace has no active device, the whole import fails with 422 "Add an active device before importing auto replies." WABA/Twilio/other channels cannot be targeted.
  6. Provider is not set by the import, so the model's creating hook stamps the workspace default engine; on a WABA-default workspace a Baileys rule is stamped waba and then never matches on the Baileys lookup for welcome/away kinds (QUIRK; the same bug was fixed in store()).
  7. Imported non-custom types (share_contact, send_catalog, request_location) have no target id column, so they save with no target and at runtime fall through to the custom branch and reply nothing while still counting a fire (QUIRK). Media message types (image, video, document) import with text only and no file, so they send a URL-less media payload (QUIRK).
  8. `user_id` is set to the importing user on updates too. The matched existing row's provider and other columns not in the update array are untouched. Duplicates within the same file update the same row (last wins).
  9. No limit on row count; a huge file is processed synchronously in the request.
- **Async & events:** None (synchronous). No audit or notification.
- **External systems:** None.
- **Settings:** Package flag `access_keyword_replies`.
- **Acceptance criteria:**
  - Given a CSV with 2 valid rows and 1 row without a keyword, when uploaded, then the response says "Imported 2 auto replies (1 skipped)." and 2 rules exist.
  - Given a keyword that already exists for the same sender, when imported again, then the existing rule is updated, not duplicated.
  - Given a workspace without an active device, when importing, then 422 "Add an active device before importing auto replies.".
  - Given a `.exe` renamed to `.csv` with a binary MIME, when uploaded, then validation rejects it.
  - Given a flow row whose flow_id belongs to another workspace, when imported, then it is counted as skipped.
  - Given a file over 5 MB, when uploaded, then validation fails.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (import, normaliseCsvHeaders, csvValue, csvNullableInt, csvBool, importCsvResponse), `resources/views/user/auto-reply/index.blade.php` (modal), `resources/js/charts/user-auto-reply-index.js` (wireImportModal), `Documentation/pages/messaging/auto-reply.html`.
- **Port notes:** Run as an async import job (BullMQ) with a per-row error report file; reuse the create-rule validation (including limit, regex check, ownership) instead of the bespoke path; support WABA and other senders by `sender_key`; add `target_contact_id`, `target_catalog_id`, media URL columns or reject those types. Enforce `autoreply_limit`.

### WD-AR-008 — Demo CSV download

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AR-007
- **Summary:** Downloads a sample CSV showing the expected columns and two example rows.
- **Actors & access:** Workspace admin/owner. No plan gate.
- **UX & screens:** Link "Download demo CSV" in the import modal.
- **Endpoints:**

| Method uri              | Route name               | Action                      | Middleware                      | Request | Response                                                   |
| ----------------------- | ------------------------ | --------------------------- | ------------------------------- | ------- | ---------------------------------------------------------- |
| GET auto-reply/demo-csv | user.auto-reply.demo-csv | AutoReplyController@demoCsv | web, auth, workspace.role:admin | none    | `text/csv; charset=UTF-8` attachment `auto-reply-demo.csv` |

- **Data:** Static content: header `keyword,matching_method,fuzzy_similarity,device_id,reply_type,message_type,reply_text,status,cooldown,timeout`; row 1 pricing/contains/80/(blank)/custom/text with a pricing reply/active/60/300; row 2 support/exact/80/(blank)/custom/text with a support reply/active/60/300.
- **Rules & edge cases:** 1. Sample does not include flow_id, template_id or phone columns even though they are accepted. 2. Content is hard-coded English.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an admin, when requesting the route, then a CSV file with the header above and two data rows downloads.
  - Given the downloaded file, when imported unchanged into a workspace with an active device, then 2 rules are created.
  - Given an agent-role user, then the request redirects to `/team-inbox`.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (demoCsv).
- **Port notes:** Generate the file from the import schema so both stay in sync.

### WD-AR-009 — Create/edit wizard shell, stepper, review and edit hydration

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-AR-010, WD-AR-012
- **Summary:** One page builds and edits a rule as a 5-step wizard: Trigger, Schedule, Reply type, Compose, Review. It shows a live WhatsApp-style preview and submits via fetch (multipart) to create or update. The same blade serves create (`/auto-reply/create`) and edit (`/auto-reply/create?id=N`).
- **Actors & access:** Workspace admin/owner. No plan check on the GET (paywall overlay only).
- **UX & screens:** `resources/views/user/auto-reply/create.blade.php` with page module `user-auto-reply-create.js`.
  - Sticky toolbar: back link, breadcrumb "Auto Reply / New" or "Auto Reply / Edit - #<id>", a static "Draft / unsaved" pill and a "Save draft" button that does nothing (QUIRK, dead control).
  - Stepper: five clickable nodes; clicking a later node validates the current step first, earlier nodes are always reachable. Prev/Next buttons; the last step swaps Next for a submit button labelled "Activate rule" (edit mode: "Update auto reply"). "Step N of 5" label.
  - Step 1 Trigger (required): trigger-type tiles Keyword / Welcome Message / Away (WD-AR-013, 015, 016) or, when the chosen sender is Instagram, five IG tiles (WD-AR-028); Priority number 0-9999 (WD-AR-018); Rule name (required, internal label); Sender picker (WD-AR-011); Keywords chips and Match method segment (Fuzzy, Exact, Contains, Regex, Any message) with a similarity slider (WD-AR-013, 014); for Welcome/Away a panel with excluded numbers, resend/resume, agent override, working hours (WD-AR-020 to 022).
  - Step 2 Schedule and limits (optional): Cooldown (seconds) and Reply delay (seconds) (WD-AR-019).
  - Step 3 Reply type (required): tiles Custom reply, Run a flow, Share a contact, Send a catalog, Request location, each with a target picker where needed (contact select of up to 500 workspace contacts ordered by name; catalog select of the workspace's `wa_catalogs`).
  - Step 4 Compose: custom branch with tabs Text, Image, Document, Video, Template (WD-AR-023) or flow branch with a searchable card list of active flows (WD-AR-024).
  - Step 5 Review: summary cards (rule name, sender count, keyword count, match method, cooldown, delay, reply type) and an "Activate immediately" switch (default on).
  - Right rail: live preview phone with a fixed inbound "hi" bubble and the reply bubble mirroring the text as typed or the chosen template body; it does not render media or placeholders.
  - Per-step validation gates (client only): step 1 requires a rule name, at least one ticked sender, and at least one keyword chip unless the rule is a responder (welcome/away); step 3 requires a contact for share_contact and a catalog for send_catalog; step 4 requires a chosen flow for flow, and non-empty reply text for the Text tab of a custom reply. Failures show an error toast and pulse the offending field. Media tabs, template tab and captions have no required check on the client.
  - Submit: builds FormData, posts to `/auto-reply` or (with `_method=PATCH`) `/auto-reply/{id}`; success toast "Auto reply saved." / "Auto reply updated." and redirect to `redirect_url` (the list); errors show the first validation message or `HTTP <status>` and re-enable the button.
  - Edit hydration: the blade injects `window.WA_AUTOREPLY_ROW` (id, name, keywords split on commas, device, sender_key, matching_method, is_catch_all, fuzzy, cooldown, timeout, reply_type, flow_id, target ids, message_type, non-outside contents, trigger_type, ig_trigger, agent flags, resend/resume values converted from seconds using the stored unit, working_hours, excluded_numbers, outside message). JS re-applies them. A stored `out_of_hours` rule opens as a Welcome Message.
  - Edit-mode gaps (QUIRKS): media files cannot be re-filled, and saving without re-upload drops the file (WD-AR-012); image and video caption prefill looks up element ids `img-cap`/`vid-cap` that do not exist (real ids are `image-cap`/`video-cap`), so captions are not restored; the server pre-ticks every sender that has the same keyword, but the JS then unticks all except the row's own sender key, so extra senders are lost visually; the "Save draft" button is inert.
- **Endpoints:**

| Method uri                 | Route name             | Action                     | Middleware                      | Request       | Response                                                                    |
| -------------------------- | ---------------------- | -------------------------- | ------------------------------- | ------------- | --------------------------------------------------------------------------- |
| GET auto-reply/create      | user.auto-reply.create | AutoReplyController@create | web, auth, workspace.role:admin | optional `id` | HTML                                                                        |
| GET auto-reply/create?id=N | user.auto-reply.create | AutoReplyController@create | same                            | `id`          | HTML pre-filled; unknown id silently renders the empty create form (no 404) |

- **Data:** Reads `keyword_replies` (+contents), `devices`, `wa_provider_configs` etc. via `WorkspaceEngine::senders`, `wa_templates` (approved for the workspace, newest first), `flows` (workspace members' flows with `is_active` true, ordered by `updated_at` desc), `contacts` (workspace, up to 500), `wa_catalogs`. Sender list is CONNECTED senders only (Baileys devices with status `connected`); on edit the row's already-bound device is kept even if disconnected.
- **Rules & edge cases:**
  1. Senders offered: all connected senders across enabled WhatsApp engines, then Instagram, Facebook, Telegram, LINE, WeChat, Viber and Email senders appended when connected (each channel appended separately). SMS and TikTok senders are not offered (QUIRK, though their webhooks do call the dispatcher).
  2. Flow list uses `flows.user_id IN workspace member ids`, not `flows.workspace_id`; only `is_active` flows are shown even if unpublished (a DRAFT badge is shown).
  3. Regex hint is shown under the match method when Regex is chosen ("one case-insensitive pattern, no delimiters"). The chip input treats a comma as a separator so a regex with `{2,4}` cannot be typed as one chip (QUIRK).
  4. Fuzzy is the default match segment for new rules; exact is the default in the CSV import and API.
  5. Keyword chips start pre-filled with "hi", "hello", "hey" in the markup for new rules (demo values that get saved unless removed).
  6. Reply text starts pre-filled with a demo greeting containing `{{ name }}` and a character counter "N / 1024" although the server limit is 4096.
  7. Copy claims media limits (image 5 MB, document 100 MB, video 16 MB / 30 s) that the server does not enforce.
- **Async & events:** None until submit.
- **External systems:** None.
- **Settings:** Sender availability depends on engine and channel-enable settings; templates depend on the workspace engine (WABA shows only Meta-approved templates).
- **Acceptance criteria:**
  - Given a new rule, when the admin leaves Rule name empty and clicks Next, then an error toast "Enter a rule name." appears and the field is highlighted.
  - Given step 1 is complete, when the admin jumps straight to step 5 via the stepper, then step 1 to 4 validations still run and block on the first failing step.
  - Given an existing rule id, when opening `/auto-reply/create?id=<id>`, then all fields are pre-filled and the submit button reads "Update auto reply".
  - Given a welcome rule saved earlier, when editing, then the Welcome tile is active and working hours, resend and excluded numbers are restored.
  - Given a valid form, when Activate is pressed, then a POST is sent and the browser lands on `/auto-reply`.
  - Given the "Activate immediately" switch is off, when saving, then the rule is created paused.
- **Source refs:** `resources/views/user/auto-reply/create.blade.php`, `resources/js/charts/user-auto-reply-create.js`, `app/Http/Controllers/AutoReplyController.php` (create), `app/Services/WorkspaceEngine.php` (senders), `Documentation/pages/messaging/auto-reply.html`.
- **Port notes:** Rebuild as a Next.js multi-step form with one Zod contract in `packages/contracts` shared by API and UI. Fix the QUIRKs (don't ship the dead Save draft button unless drafts are real; restore all senders; keep media on edit). Live preview should render placeholders and media. Use a single sender key concept (`channel:accountId`).

### WD-AR-010 — Create rule endpoint: validation, gates, ownership, transaction

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-029
- **Summary:** Persists a new rule (and one sibling row per additionally chosen sender) with its content variants, after plan checks and ownership checks.
- **Actors & access:** Workspace admin/owner. Enforces package flag `access_keyword_replies` then numeric cap `autoreply_limit` (count of the workspace's non-deleted rules, including flow-managed ones, counted once before fan-out; platform admins bypass; 0/null/negative = unlimited).
- **UX & screens:** Called by the wizard (WD-AR-009). Responses drive the toast and redirect.
- **Endpoints:**

| Method uri      | Route name            | Action                    | Middleware                      | Request               | Response                                                                                          |
| --------------- | --------------------- | ------------------------- | ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| POST auto-reply | user.auto-reply.store | AutoReplyController@store | web, auth, workspace.role:admin | see below (multipart) | 201 JSON `{ok, message, data{id, created_ids[], devices_count, redirect_url}}`; 422 with `errors` |

Request fields and validation:

- `keyword`: required unless `is_catch_all` is 1/true; nullable string max 255. (For welcome/away rules the wizard sends the rule name here.)
- `is_catch_all`: nullable boolean. `matching_method`: required in exact, fuzzy, contains, regex. `fuzzy_similarity`: nullable integer 0..100 (default 80).
- Sender: `sender[]` (array min 1, each string max 64, composite `engine:id`) OR legacy `device_id` (integer) / `device_ids[]` (array min 1 of integers); one of the three is required (`required_without_all`).
- `reply_type`: required in custom, flow, share_contact, send_catalog, request_location. `flow_id` required if flow; `target_contact_id` required if share_contact; `target_catalog_id` required if send_catalog (nullable integers).
- `cooldown`, `timeout`: nullable integer 0..86400. `status`: nullable boolean (default true).
- `trigger_type`: nullable in keyword, welcome, out_of_hours, away. `ig_trigger`: nullable in dm_keyword, comment_to_dm, story_reply, story_mention, mention. `priority`: nullable integer 0..9999.
- `resend_value`, `resume_value`: nullable integer 0..100000; `resend_unit`, `resume_unit`: minutes, hours, days. `stop_on_agent_reply`: nullable boolean.
- `wh_enabled` boolean; `wh_days[]` in mon..sun; `wh_from`, `wh_to`: string max 5; `wh_timezone` string max 64; `wh_outside_action` in send, none.
- `excluded_numbers` (free text or array); `excluded_group_ids[]` integers.
- `contents[]` array: `content_type` in text, image, video, document, template; `content` string max 4096; `template_id` integer; `is_selected` boolean; `sort_order` integer; file at `contents[i][media]`.
- `outside_contents[]` same shape (content_type, content max 4096, template_id, media).
- **Data:** Writes `keyword_replies` (one row per resolved sender), `keyword_reply_contents` (custom only). Primary `message_type` = `contents[0].content_type` if valid, else text. Defaults: `provider` (see WD-AR-011), `status` true, `fuzzy_similarity` 80, `keyword` '' when absent, `canonical_language` en (column default), `trigger_count` 0.
- **Rules & edge cases:**
  1. Regex rules: the keyword must compile (tested with `~pattern~iu`, with a non-unicode retry); otherwise 422 on `keyword` with a message asking to check the pattern.
  2. Sender resolution and ownership are in WD-AR-011; when no valid sender remains, 422 `errors.sender` "No valid senders in this workspace." (or `errors.device_id` on the legacy path).
  3. Ownership checks: flow id must belong to a flow owned by a workspace member (422 "Flow not found in this workspace."); share_contact contact must belong to a workspace member (`contacts.user_id`); send_catalog catalog must have `workspace_id` = current (422 messages "Contact not found..." / "Catalog not found...").
  4. The plan cap is checked once before fan-out, so a single request with N senders can exceed the cap by N-1 (QUIRK).
  5. `target_contact_id`, `target_catalog_id`, `flow_id` are stored only when the reply_type matches; otherwise null.
  6. Non-custom types skip content persistence; custom types call syncContents and syncOutsideContents (WD-AR-023).
  7. Whole create is a single DB transaction; uploaded files already written to storage are not rolled back on failure.
  8. Translation fan-out is intentionally NOT done at save (instant save); translations are lazy at runtime (WD-AR-033).
  9. No uniqueness: identical keywords can be created many times per sender (matching then takes the lowest id).
  10. The rule cap counts by `workspace_id`, not by user.
  11. Response message is "Auto reply saved." or "Auto reply created on N senders.".
- **Async & events:** No queue, no webhook, no notification, no audit log entry (WaDesk writes none for rule CRUD).
- **External systems:** Media storage for uploads.
- **Settings:** `autoreply_limit` (package), `access_keyword_replies` (package), plan overrides on the workspace.
- **Acceptance criteria:**
  - Given a workspace at its `autoreply_limit`, when creating a rule, then 422 with `error: plan_limit_reached` and the human message about the limit.
  - Given `matching_method=regex` and keyword `(unclosed`, when saving, then 422 on `keyword`.
  - Given `reply_type=flow` with a flow of another workspace, when saving, then 422 "Flow not found in this workspace.".
  - Given `is_catch_all=1` and no keyword, when saving, then the rule is created with an empty keyword.
  - Given 3 valid senders in `sender[]`, when saving, then 3 rules are created and the message reads "Auto reply created on 3 senders.".
  - Given a forged sender key not in the workspace, when saving alone, then 422 "No valid senders in this workspace.".
  - Given a non-catch-all rule with a blank keyword, when saving, then validation fails.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (store, responderColumns, guessPrimaryMessageType, syncContents), `app/Models/KeywordReply.php`, `app/Services/PlanLimitGuard.php`, `app/Exceptions/PlanLimitReachedException.php`.
- **Port notes:** New tables `auto_reply_rules` and `auto_reply_contents` (RLS forced, composite FKs including workspace_id). Emit audit and outbox events (`auto_reply.created`). Enforce the cap on the number of rows to be created, not before fan-out. Add a partial unique index on (workspace_id, sender_id, keyword) where deleted_at is null if duplicates should be rejected (WaDesk allows them).

### WD-AR-011 — Sender selection, engine stamping and multi-sender fan-out

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-010
- **Summary:** A rule is always bound to exactly one sender (a WhatsApp number on any engine, or an Instagram/Facebook/Telegram/LINE/WeChat/Viber/Email account). Ticking several senders in the wizard creates one independent rule row per sender, each stamped with the engine of its own sender.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** The unified sender picker component (`x-sender-picker`, name `sender`, multiple) in Step 1. Label reads "Sender" or "Senders" (plus "Multi-sender - tick all that apply") depending on how many senders exist. Helper text when more than one: "Each ticked sender gets its own row - toggle / delete each independently from the list later.". JS enforces one engine class per rule: ticking an Instagram sender clears every other box (an IG rule targets exactly one account), and ticking any other sender clears Instagram boxes; WhatsApp senders may be combined. When the ticked sender is Instagram the trigger tiles switch to the IG set (WD-AR-028) and the WhatsApp-only reply tiles (share contact, catalog, location) are hidden.
- **Endpoints:** Part of `POST auto-reply` and `PATCH auto-reply/{id}` (WD-AR-010, WD-AR-012); no separate route.
- **Data:** Per created row: `device_id` = the sender row id (a `devices.id` for Baileys, a `wa_provider_configs.id` for WABA/Twilio, the Instaflow account id for Instagram, the channel row id for others), `provider` = lowercase engine of the chosen sender (`baileys`, `waba`, `twilio`, `instagram`, `facebook`, `telegram`, `line`, `wechat`, `viber`, `sms`, `email`), `user_id` = creator, `workspace_id` = current.
- **Rules & edge cases:**
  1. Preferred input is `sender[]` composite keys `engine:id`; each is validated with `WorkspaceEngine::senderForKey` against the workspace's usable senders (the key's own engine is always included, so IG/FB etc. resolve). Invalid or forged keys are dropped silently; if none survive, 422. Duplicates (same engine and id) collapse.
  2. Legacy input: `device_id` or `device_ids[]` (bare integers) resolve only against Baileys `devices` of the workspace (workspace members' orphan rows allowed); forged ids are dropped silently; a bare device is always stamped `baileys` (or the device's own `provider` if set). This deliberately does NOT use the workspace default engine (a fixed bug: a WABA-default workspace stamped Baileys welcome/away rules `waba`, which then never fired on the Baileys lookup). A data-repair migration re-stamped existing welcome/away/out_of_hours rows bound to real `devices` rows to `baileys`.
  3. When the model is created without a provider, a `creating` hook stamps the workspace default engine (`WorkspaceEngine::for`); this is what the CSV import and the flow-sync path rely on.
  4. NULL/empty provider rows exist in old data and are treated as "any engine" by listing and by the auto-responder scopes.
  5. A rule cannot span senders: siblings are separate rows with separate counters, statuses and analytics; toggling or deleting one does not affect the others.
  6. Keyword-race scoping at runtime does not filter by provider (only by device id, see WD-AR-032), so ids from different channel tables can collide (QUIRK).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** Enabled engines per workspace (`allowed_send_methods`, workspace engine settings), `facebook_enabled`, `telegram_enabled`, `email_enabled`, connected channel accounts.
- **Acceptance criteria:**
  - Given a workspace with a Baileys number and a WABA number, when both are ticked and saved, then two rules exist, one with `provider=baileys` and one with `provider=waba`.
  - Given an Instagram sender is ticked, when the admin also ticks a WhatsApp sender, then the Instagram box is unticked.
  - Given a submitted key `baileys:999` that is not a sender of this workspace, when saved, then it is ignored and, if it was the only key, the request fails with 422.
  - Given a WABA-default workspace and a Baileys device picked through the legacy `device_id` field, when saved, then `provider=baileys`.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (store target resolution), `app/Services/WorkspaceEngine.php` (senders, senderForKey, parseSenderKey), `app/Models/KeywordReply.php` (booted), `database/migrations/2026_08_21_000300_fix_baileys_autoresponder_provider_stamp.php`, `database/migrations/2026_05_26_150000_add_provider_to_engine_scoped_tables.php`, `resources/js/charts/user-auto-reply-create.js`.
- **Port notes:** Model the sender as a foreign key to a unified `channel_accounts` table (owned by WADEV/WABA/other channel modules) instead of the polymorphic `device_id` + `provider` pair; that removes the id-collision class of bugs. Keep the "one rule per sender" model or move to a join table (`auto_reply_rule_senders`) so one edit can change all senders atomically.

### WD-AR-012 — Update rule endpoint: partial updates, sibling fan-out, content replacement

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-010
- **Summary:** Edits one rule. It accepts full wizard payloads or tiny partial patches, replaces content variants when they are posted, and can fan the rule out to additional senders as sibling rows.
- **Actors & access:** Workspace admin/owner; plan flag enforced (no numeric cap check).
- **UX & screens:** Called by the wizard in edit mode via POST with `_method=PATCH` (WD-AR-009); the response redirects to the list.
- **Endpoints:**

| Method uri            | Route name             | Action                     | Middleware                                  | Request                                                                                                 | Response                                                                                         |
| --------------------- | ---------------------- | -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| PATCH auto-reply/{id} | user.auto-reply.update | AutoReplyController@update | web, auth, workspace.role:admin; id numeric | same fields as store, all `sometimes`; keyword sometimes, string, max 255; `sender[]` may be any length | JSON `{ok, message, data{id, redirect_url, row}}`; 403 `{ok:false,message}` for a foreign device |

- **Data:** Updates `keyword_replies`; deletes and recreates `keyword_reply_contents` (all roles) when `contents` is present; deletes and recreates outside-hours variants when `outside_contents` is present; may create/update sibling `keyword_replies` rows.
- **Rules & edge cases:**
  1. Responder columns (trigger_type, ig_trigger, priority, resend, agent override, working hours, exclusions) are recomputed only when the request carries `trigger_type` (a full wizard save). A partial patch (for example a status toggle) never wipes an existing welcome rule's schedule, resend or exclusions.
  2. When `sender[]` is present, the FIRST resolved sender becomes this row's `device_id` and `provider` (validated by `senderForKey`, so no extra ownership check); every additional sender becomes a sibling row found-or-created by (workspace, device, keyword) and filled with this row's method, similarity, reply type, targets, cooldown, timeout, status, message_type and copies of its content variants. Deselecting a sender never deletes its row (additive only). Response message "Auto reply updated - now on N senders.".
  3. Legacy `device_ids[]` behaves the same (first wins, rest siblings, treated as Baileys). A single legacy `device_id` must belong to the workspace (or an orphan row owned by a member), otherwise 403 "Selected device is not in this workspace.".
  4. Regex keywords are re-validated when both method regex and keyword are sent.
  5. NO ownership re-check for `flow_id`, `target_contact_id`, `target_catalog_id` on update (store does check). Contacts and catalogs are re-scoped at read time, but a foreign `flow_id` would launch another tenant's flow if that flow is live (QUIRK / cross-tenant risk; fix in port).
  6. `message_type` is not recomputed on update, so changing the first variant from text to image leaves the list badge stale (QUIRK).
  7. Posting `contents` deletes all existing variants without deleting their uploaded files (orphaned blobs) and re-inserts the posted ones. Because the wizard cannot re-fill file inputs, saving an edited media rule without re-uploading loses the file reference: the variant remains but has no file (QUIRK; runtime then sends a media payload with no URL on the Baileys path, or falls back to caption text on the dispatcher path).
  8. `contents` and `outside_contents` are not validated on update (store validates lengths and types); an unknown `content_type` is stored as posted for primary variants.
  9. `reply_type` changes do not null out unrelated targets (a rule switched from flow to custom keeps its old `flow_id`).
  10. If posted contents contain no `is_selected`, the first variant (by sort_order) is force-selected so the rule can fire.
  11. Editing a flow-managed rule works but is overwritten on the next flow save.
- **Async & events:** None. No audit entry.
- **External systems:** Media storage for new uploads.
- **Settings:** Package flag `access_keyword_replies`.
- **Acceptance criteria:**
  - Given a paused rule, when PATCHed with only `status=1`, then it becomes active and no responder columns change.
  - Given a rule edited with two extra senders ticked, when saved, then two sibling rules are created (or updated if the same keyword already exists on that sender) and the message says "now on 3 senders".
  - Given a forged legacy `device_id`, when PATCHed, then 403.
  - Given a rule with one text variant, when PATCHed with a new `contents[0][content]`, then the old variant is gone and the new one is selected.
  - Given a rule of another workspace, when PATCHed, then 404.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (update, syncContents, syncOutsideContents, responderColumns).
- **Port notes:** Validate the same Zod schema as create; verify every referenced id on update; keep partial-update semantics via `PATCH` with explicit fields; delete blobs post-commit; recompute `message_type` (or drop the denormalised column and derive the badge from variants).

### WD-AR-013 — Keyword trigger: keyword list, match methods, similarity, regex

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-010
- **Summary:** The classic rule: one rule holds one or more comma-separated keywords and a match method that decides how the inbound text is compared. This entry covers how the operator defines and stores it; the runtime semantics are in WD-AR-031.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Step 1 of the wizard. Trigger tile "Keyword" (default). Keywords field: chip input where Enter or comma adds a chip, x removes it; leftover typed text is folded in on submit and on validation; chips are de-duplicated case-insensitively preserving order; at least one chip is required (rule name is separate and is only an internal label). Match method segment: Fuzzy (default in the wizard), Exact, Contains, Regex, and Any message (WD-AR-014). Similarity slider 0-100 (default 80, labelled loose to strict) enabled only for Fuzzy (otherwise dimmed and disabled). Help text under Fuzzy: catches typos like "pricng" for "pricing". Regex shows an inline hint: the keyword field is one case-insensitive pattern, no delimiters needed, example alternation of price, cost, quote.
- **Endpoints:** `POST auto-reply` / `PATCH auto-reply/{id}` fields `keyword`, `matching_method`, `fuzzy_similarity`.
- **Data:** `keyword_replies.keyword` varchar(255): the chips joined with ", " (plain text, never encrypted, because it is the SQL match key). `matching_method` varchar(12) in exact, fuzzy, contains, regex (default exact). `fuzzy_similarity` tinyint 0..100 default 80. Rule name (the wizard's separate "Rule name" field) is NOT stored separately: it is the first keyword for keyword rules; on edit the wizard shows the first keyword as the rule name (QUIRK: renaming a keyword rule's "name" does nothing on its own).
- **Rules & edge cases:**
  1. The 255-character limit applies to the joined list.
  2. `matching_method` accepts only exact/fuzzy/contains/regex on the server; the UI value `any` is translated into `is_catch_all` (WD-AR-014) with method sent as exact.
  3. Regex: stored as one raw pattern (commas are part of the pattern), validated at save (WD-AR-010). The chip UI splits on commas, so quantifiers such as `{2,4}` cannot be entered through chips (QUIRK; the leftover-text fold-in on submit also splits on commas, so a regex containing a comma cannot be entered through this UI at all).
  4. Stored keyword case is preserved; matching is case-insensitive.
  5. Multiple keywords in one row share the same method and threshold; there is no per-keyword method.
  6. The import and API default the method to exact; the wizard default is fuzzy.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given chips hi, hello, hey, when saved with Exact, then `keyword` is "hi, hello, hey" and `matching_method` is exact.
  - Given the Regex method with pattern `(?:price|cost)`, when saved, then it is accepted; with `(oops`, 422.
  - Given Contains is selected, then the similarity slider is disabled.
  - Given no chips and empty input on step 1, when Next is pressed, then "Add at least one keyword." appears.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (store validation), `app/Models/KeywordReply.php` (MATCHING_METHODS, isValidRegex), `resources/views/user/auto-reply/create.blade.php`, `resources/js/charts/user-auto-reply-create.js`.
- **Port notes:** Store keywords as a `text[]` (or child table) instead of a comma string; keep a per-rule method. Validate regex with a linear-time engine (RE2) to avoid ReDoS; WaDesk runs operator regexes with PCRE against untrusted input.

### WD-AR-014 — Any-message default route (catch-all)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AR-013
- **Summary:** "Any message" makes a rule the workspace/sender default route: it runs only when no keyword rule matched a typed message, so it can never outrank a keyword.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** The last segment "Any message" in the match method control. Selecting it dims and disables the keyword chip box and shows the note "Runs only when no keyword rule matches this message. Keyword rules always win.". Rule name is still required and is stored in `keyword` as a display label.
- **Endpoints:** `POST auto-reply` / `PATCH auto-reply/{id}` with `is_catch_all` 1/0.
- **Data:** `keyword_replies.is_catch_all` tinyint default 0. Index `kwr_catchall_idx (workspace_id, device_id, is_catch_all, status)`. Flow-managed rules also set it when the trigger keyword is `*`, `.*`, `.+` or `any` (WD-AR-042). Instagram no-keyword triggers force it to 1 (WD-AR-028).
- **Rules & edge cases:**
  1. `keyword` is required unless `is_catch_all` is truthy; catch-all rules store the operator's rule name (or "Any message" if blank) as a label; matching never reads it.
  2. Only Baileys/Node lookup honours catch-all rules (WD-AR-032 step 10). The dispatcher path excludes catch-all rows from its keyword query, so on WABA, Twilio and channel bridges a wizard-created catch-all message rule never fires (QUIRK, see WD-AR-039). Flow catch-alls do work on WABA/Twilio because the Node provider-flow bridge calls the same lookup.
  3. Text only: an empty-text photo or voice note does not use the default route; catch-all rules are excluded from the media-order fallback.
  4. Precedence among catch-alls: a rule bound to the resolved device beats a workspace-wide (null device) rule, then lowest id.
  5. A catch-all still passes through flow-liveness and billing checks.
  6. Edit restores the "Any message" segment from the flag; the stored filler method (exact) is never shown.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a keyword rule "book" (flow A) and a catch-all rule (flow B) on the same device, when the customer types "book me", then flow A starts.
  - Given the same setup, when the customer types "hello", then flow B starts.
  - Given a catch-all saved without keywords, when the list renders, then the row shows the rule name and "exact".
  - Given an inbound image with no caption, when a catch-all exists but no order flow, then nothing fires.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (lookup pass 2), `app/Models/KeywordReply.php` (scopeMatchKeyword), `database/migrations/2026_07_20_120000_add_is_catch_all_to_keyword_replies.php`, `app/Models/Flow.php`, `resources/js/charts/user-auto-reply-create.js`.
- **Port notes:** Model as `trigger_type = 'default_route'` with its own tier in the resolver instead of a flag plus a magic keyword. Make it work on all channels.

### WD-AR-015 — Welcome Message trigger

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AR-035
- **Summary:** A keyword-less rule that greets a customer once when they start a brand-new conversation, with an optional resend window, agent-override pause, working hours with a separate "we are closed" message, and excluded recipients.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Trigger tile "Welcome Message" ("Greet a customer when they start a new conversation."). Selecting it hides the keyword and match-method blocks and reveals a panel: Excluded recipients textarea (WD-AR-022), Message rules with Resend after (value plus Minutes/Hours/Days, default 24 hours), Resume after (default 24 hours, only relevant with the agent-override switch), the switch "Stop auto reply when an agent replies" (WD-AR-020), and an "Enable working hours" block (WD-AR-021). A blue note explains "sent once when a customer starts a new conversation - resent only after the window below". The Rule name is required and is stored in `keyword`.
- **Endpoints:** `POST auto-reply` / `PATCH auto-reply/{id}` with `trigger_type=welcome` and the responder fields.
- **Data:** `trigger_type='welcome'`, `matching_method` stored as exact, `is_catch_all` 0, `cooldown` = resend seconds, plus responder columns (WD-AR-035). The reply (any reply type, including flow) is defined in steps 3 and 4 like any rule.
- **Rules & edge cases:**
  1. Fires only when the conversation is genuinely new: at most one inbound bubble (the message being processed) and zero outbound bubbles (or no stored conversation yet). An existing team-inbox chat never gets a welcome (reason `not_new_conversation`).
  2. Resend window default 24 hours when blank; per contact throttling is tracked on the conversation's `routing_meta.ar_fires[ruleId]` timestamp, not in the log tables.
  3. A welcome rule runs before away, out-of-hours and keyword matching, and a fired welcome ends resolution for that message (a keyword reply is not sent in addition). Lower `priority` number and then lower id go first among several welcome rules; the first rule that fires wins.
  4. With working hours enabled and outside action send, the outside-hours message replaces the greeting (`use_outside`); with outside action none the rule stays silent outside hours.
  5. Keyword-less: welcome rules are excluded from the main keyword race by `trigger_type`. The live-translation stage of the Baileys lookup (WD-AR-033) does not filter on `trigger_type`, so a welcome or away rule whose rule name is a substring match for a translated message can be returned as a keyword hit (QUIRK).
  6. Instagram senders cannot use the welcome tile (IG has its own triggers).
  7. Effects on Node cooldown: the lookup returns the rule's `cooldown` (the resend window, default null so 0) which Node applies as a per-customer cooldown for all non-flow replies (QUIRK, see WD-AR-038).
- **Async & events:** As WD-AR-034 (Baileys) and WD-AR-039 (dispatcher). Stamps `routing_meta.ar_fires` on fire.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an active welcome rule, when a brand-new number sends its first message, then exactly one greeting is sent.
  - Given the same contact sends a second message within the resend window, then no greeting is sent.
  - Given an existing chat with prior outbound messages, when the customer writes after the resend window, then no greeting is sent.
  - Given working hours 09:00-18:00 with outside action send, when a new customer writes at 22:00, then the outside-hours message is sent instead.
  - Given the contact's number is in the excluded list, then no message is sent.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (autoResponderReplyForBaileys, responderColumns), `app/Services/Inbox/AutoResponderEvaluator.php` (evaluateWelcome, isFirstContact), `app/Services/Inbox/KeywordReplyDispatcher.php`, `app/Models/KeywordReply.php` (scopeWelcomeFor), `database/migrations/2026_07_31_010000_add_welcome_autoresponder_to_keyword_replies.php`.
- **Port notes:** Store per-contact fire times in a dedicated table (`auto_reply_fires (rule_id, conversation_id, last_fired_at)`) instead of a JSON map on the conversation. Decide "new conversation" from an explicit conversation state rather than counting bubbles.

### WD-AR-016 — Away trigger

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AR-035
- **Summary:** A keyword-less rule that answers every inbound while the workspace's manual Away mode (WD-AR-003) is on, like a WhatsApp Business away message.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Trigger tile "Away" ("Reply while Away mode is on - great for lunch breaks or time off."). Same responder panel as Welcome but without the working-hours block (hidden and cleared for Away). An amber note says the rule fires while Away mode is switched on and points to the toggle on the list page.
- **Endpoints:** `POST auto-reply` / `PATCH auto-reply/{id}` with `trigger_type=away`.
- **Data:** `trigger_type='away'`; responder columns (exclusions, resend/cooldown, agent override). `working_hours` is not settable in the UI for away.
- **Rules & edge cases:**
  1. Fires only when `workspaces.inbox_away` is on; evaluator fails closed (not away) on any lookup error.
  2. Gate order: away flag, excluded recipients, agent pause, resend window (default 24 hours if `cooldown` blank).
  3. The away pass runs after welcome and before out-of-hours and keyword matching; the first away rule that fires ends resolution.
  4. Away replies are not restricted to new conversations.
  5. Uses the primary content variant; there is no outside-hours variant for away.
- **Async & events:** Stamps `routing_meta.ar_fires`. Logs via the same fire log as other rules.
- **External systems:** None.
- **Settings:** `workspaces.inbox_away`.
- **Acceptance criteria:**
  - Given Away mode is on and an away rule is active, when a customer writes, then the away reply is sent once.
  - Given the customer writes again within 24 hours, then nothing is sent.
  - Given Away mode is off, then the rule never fires.
  - Given the customer is in the excluded numbers, then the away reply is not sent.
- **Source refs:** `app/Services/Inbox/AutoResponderEvaluator.php` (evaluateAway, isWorkspaceAway), `app/Models/KeywordReply.php` (scopeAwayFor), `app/Http/Controllers/AutoReplyController.php`, `app/Services/Inbox/KeywordReplyDispatcher.php`.
- **Port notes:** Same resolver tier as welcome; consider per-sender away switches.

### WD-AR-017 — Out-of-hours trigger (no UI, legacy)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AR-035
- **Summary:** A rule with `trigger_type=out_of_hours` fires on any inbound that arrives outside its own working hours. The engine, evaluator and both runtime paths support it, but the wizard no longer offers it: off-hours behaviour is now configured as a Welcome Message with working hours (WD-AR-021).
- **Actors & access:** Only reachable through API/CSV-less paths that post `trigger_type=out_of_hours` (the Api/App controller or a direct POST); existing rows open in the wizard as Welcome.
- **UX & screens:** None. The edit hydration maps `out_of_hours` to `welcome`, so re-saving converts it.
- **Endpoints:** `POST auto-reply` accepts the value (validation allows it).
- **Data:** `trigger_type='out_of_hours'`; requires `working_hours.enabled`.
- **Rules & edge cases:**
  1. If `working_hours` is not enabled the rule can never fire (guards against an always-on responder).
  2. Fires when the current time in the rule's timezone is outside days/from/to; then excluded, agent-pause and resend (24h default) gates apply.
  3. Runs after welcome and away, before keyword matching.
  4. Resolved at runtime with `use_outside` false: the primary content variant is sent, not the outside-hours variant.
- **Async & events:** As other responders.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an out_of_hours rule with hours Mon-Fri 09:00-18:00 Asia/Riyadh, when a customer writes Saturday, then it replies once per 24 hours.
  - Given the same rule during hours, then it does not fire.
  - Given `working_hours` disabled, then it never fires.
- **Source refs:** `app/Services/Inbox/AutoResponderEvaluator.php` (evaluateOutOfHours), `app/Models/KeywordReply.php` (scopeOutOfHoursFor), `resources/js/charts/user-auto-reply-create.js` (legacy mapping), `database/migrations/2026_07_31_020000_add_autoresponder_away_outofhours.php`.
- **Port notes:** Either drop (fold into welcome with hours, as the UI did) or keep as a first-class trigger with a proper UI.

### WD-AR-018 — Rule priority

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AR-015
- **Summary:** A Priority number (0-9999, lower wins, default 0) decides which rule goes first when several auto-responder rules could answer the same inbound.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Number input "Priority" in Step 1 for every trigger type with help "Lower number = higher priority when several rules could reply to the same message." Shown even for plain keyword rules where it has no effect (QUIRK).
- **Endpoints:** `priority` on store/update (nullable integer 0..9999; stored as max(0, value)).
- **Data:** `keyword_replies.priority` int default 0, indexed.
- **Rules & edge cases:**
  1. Only welcome, away and out-of-hours scopes order by `priority` then `id`.
  2. The keyword race, the translation stage, the fuzzy stage and the default route ignore priority and take the first row in database order (effectively lowest id).
  3. No tie-break beyond id.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given two active welcome rules with priority 5 and 1, when a new customer writes, then the priority 1 rule fires.
  - Given two keyword rules that both match, then the lower id fires regardless of priority.
- **Source refs:** `app/Models/KeywordReply.php` (scopes), `app/Http/Controllers/AutoReplyController.php` (responderColumns), `database/migrations/2026_07_31_020000_add_autoresponder_away_outofhours.php`.
- **Port notes:** Apply priority uniformly to the whole resolver (keyword ties included); order by (tier, priority, id).

### WD-AR-019 — Cooldown and reply delay (Schedule step)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AR-038
- **Summary:** Two optional numbers on every rule: Cooldown (seconds during which the same customer should not be answered again) and Reply delay (seconds to wait before sending so the reply feels human). Both accept 0-86400 on the server.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Step 2 of the wizard: "Cooldown" (placeholder 60, "Don't re-trigger for the same user within this window.") and "Reply delay" (placeholder 2, "Adds a tiny delay so it feels human.") both in seconds; step is marked optional. The analytics page shows the cooldown as "N sec" or "no limit".
- **Endpoints:** `cooldown` and `timeout` on store/update (nullable integer 0..86400).
- **Data:** `keyword_replies.cooldown` (int unsigned, seconds) and `timeout` (int unsigned, seconds). For welcome/away rules `cooldown` is overwritten by the resend window (WD-AR-020) when a value is set.
- **Rules & edge cases:**
  1. `timeout` has two meanings: for custom/other replies it is the reply delay (Node caps at 300 s; the dispatcher path caps at 30 s); for flow replies it is the flow-session inactivity timeout (default 600 s in Node when 0/blank). The form calls it "Reply delay" only.
  2. `cooldown` is enforced only in Node's memory for the Baileys path, per device+customer for ALL rules combined (WD-AR-038); a flow-type keyword ignores it (a flow keyword always restarts the flow). On the dispatcher path the per-rule cooldown check reads an encrypted column and never matches, so it is not enforced (QUIRK, WD-AR-039).
  3. Docs describe timeout vaguely ("a window used to govern how the rule behaves"); the code meaning is the above.
  4. Review step shows "0 s" when blank.
- **Async & events:** None at save.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given cooldown 60 on a Baileys rule, when the same customer sends the keyword twice within 60 s, then only the first gets a reply.
  - Given reply delay 5, when the rule fires, then the customer receives the message about 5 seconds later.
  - Given cooldown 100000, when saving, then validation fails.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (store validation, lookup response), `node/classes/BaileysClientManager.js`, `app/Services/Inbox/KeywordReplyDispatcher.php`, `resources/views/user/auto-reply/create.blade.php`.
- **Port notes:** Enforce cooldown centrally in Redis (`ar:cd:{ruleId}:{contactId}` with TTL) for every engine, per rule as the label says, and implement the delay as a delayed BullMQ job rather than sleeping in a request or the bridge.

### WD-AR-020 — Resend window and agent override settings

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AR-035
- **Summary:** Welcome and away rules can be told how long to wait before answering the same contact again ("Resend after") and to pause when a human agent has taken over ("Stop auto reply when an agent replies", "Resume after").
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** In the responder panel (Welcome and Away only): Resend after (number, default 24, unit Minutes/Hours/Days default Hours), Resume after (same controls, note "Only used when the agent-override below is on."), and the agent-override switch. Values round-trip on edit: the stored seconds are divided by the stored unit (integer division) to show the number.
- **Endpoints:** `resend_value` and `resume_value` (0..100000), `resend_unit`, `resume_unit` (minutes/hours/days), `stop_on_agent_reply` on store/update.
- **Data:** `cooldown` = resend seconds; `resend_unit`, `resume_after` (seconds), `resume_unit`, `stop_on_agent_reply`. Conversion: minutes x60, days x86400, anything else (including missing unit) hours x3600; value 0 or less yields null (then the evaluator's defaults apply).
- **Rules & edge cases:**
  1. Keyword rules cannot set these in the UI (the wizard only sends them for welcome/away), although the runtime applies the agent-override and hours gates to matched keyword rules if the columns are set by other means (WD-AR-039 rule 8).
  2. Integer division on edit loses precision when the stored seconds do not divide evenly by the unit.
  3. Both settings evaluated by WD-AR-035.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given resend 2 hours, when saved, then `cooldown` = 7200 and `resend_unit` = hours; editing shows 2 hours.
  - Given resend blank on a welcome rule, then the effective window is 24 hours.
  - Given agent override on and an agent replied after the last auto-fire, when the customer writes again within the resume window, then the rule stays silent.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (responderColumns), `app/Services/Inbox/AutoResponderEvaluator.php` (toSeconds, resendSeconds, agentPaused), `resources/views/user/auto-reply/create.blade.php`.
- **Port notes:** Store seconds only plus a display unit; derive the unit client-side.

### WD-AR-021 — Rule working hours and outside-hours message

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AR-035
- **Summary:** A Welcome rule can carry its own weekly schedule. Inside the schedule it sends its normal greeting; outside it either stays silent or sends a dedicated "we're closed" message.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Under the Welcome panel: switch "Enable working hours"; when on, day chips Mon..Sun (Mon-Fri on by default), Start time (default 09:00), End time (default 18:00), Time zone select of all PHP timezone identifiers (default = app timezone), and radios "Do not send any auto reply" (default) versus "Send a custom 'we're closed' message" revealing a textarea. Hidden and cleared when the trigger is Away. This is not the workspace business-hours feature of TIB2.
- **Endpoints:** `wh_enabled`, `wh_days[]`, `wh_from`, `wh_to`, `wh_timezone`, `wh_outside_action`, `outside_contents[0]` on store/update.
- **Data:** `keyword_replies.working_hours` JSON `{enabled, days[], from "HH:MM", to "HH:MM", timezone, outside_action "send"|"none"}` (null when disabled); outside message stored as a `keyword_reply_contents` row with `variant_role='outside_hours'`, `is_selected=false`.
- **Rules & edge cases:**
  1. Only text is offered for the outside message in the UI (the API accepts the full content shape).
  2. Server normalisation: days intersected with mon..sun; from/to cut to 5 chars (default 09:00/18:00); timezone default app timezone; outside_action anything but `send` becomes `none`.
  3. Evaluation: "now" converted to the rule's timezone; empty days list = every day; a day not in the list is outside; from<=to is a same-day window inclusive of both ends; from>to is an overnight window (cur>=from or cur<=to); blank from/to means all-day open. String comparison of HH:MM, no seconds. Invalid timezone falls back to app time.
  4. The workspace-level business hours (TIB2) are unrelated; there is no holiday support.
  5. Also honoured for matched keyword rules at runtime when set (dispatcher path only, WD-AR-039).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** App timezone config.
- **Acceptance criteria:**
  - Given hours Mon-Fri 09:00-18:00 with outside action send and message "Closed", when a new customer writes Saturday 10:00, then "Closed" is sent.
  - Given overnight hours 22:00-06:00, when a customer writes at 23:30, then it counts as inside.
  - Given outside action none, when writing outside hours, then no reply.
  - Given a rule with working hours disabled, then `working_hours` is null after save.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (parseWorkingHours, syncOutsideContents), `app/Services/Inbox/AutoResponderEvaluator.php` (workingHours), `resources/views/user/auto-reply/create.blade.php`.
- **Port notes:** Use IANA timezones and a proper time-range type; compare in the rule's timezone using a date library, not string compare.

### WD-AR-022 — Excluded recipients (numbers and contact groups)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AR-035
- **Summary:** A responder rule can skip individual phone numbers and members of chosen contact groups.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** "Exclude individual numbers" textarea in the responder panel (one number per line, examples 201112223333 and +966501234567). There is NO UI for contact groups (the field exists in the API and evaluator only, QUIRK).
- **Endpoints:** `excluded_numbers` (free text split on newlines or commas, or an array), `excluded_group_ids[]` (integers) on store/update.
- **Data:** `excluded_numbers` JSON array of digit strings (deduped, non-digits stripped, empty removed; null if none); `excluded_group_ids` JSON array of ints.
- **Rules & edge cases:**
  1. Match: digits equal, OR (both at least 8 digits and one ends with the other) to tolerate country-code differences.
  2. Group exclusion: intersects the rule's group ids with the contact's `contact_group` (an encrypted id array; decoded in PHP). If the contact cannot be resolved, group exclusion cannot match.
  3. The contact is found by scanning the workspace's contacts newest first and comparing digits of the encrypted `mobile` in PHP (200 per chunk), memoised per inbound; expensive for large workspaces.
  4. Applies to welcome, away, out-of-hours, and (dispatcher path only) matched keyword rules.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given +966501234567 is excluded, when that number writes, then no auto-responder fires.
  - Given excluded 501234567 (9 digits), when 966501234567 writes, then it is excluded by suffix.
  - Given an excluded group containing the contact, then the rule skips that contact.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (parseExcludedNumbers), `app/Services/Inbox/AutoResponderEvaluator.php` (isExcluded).
- **Port notes:** Store normalised E.164 in a child table and look contacts up by an indexed normalised phone column (a hashed/blind index if phone is encrypted). Add a group picker to the UI.

### WD-AR-023 — Custom reply composer: text, image, document, video, template

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-AR-010
- **Summary:** For reply type Custom the operator composes the message in a tabbed editor: plain text with placeholders, an image or video with an optional caption, a document, or an approved template. The wizard saves one variant; the data model supports several.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Step 4, branch "Compose reply", tab strip Text, Image, Document, Video, Template.
  - Text: toolbar (B, I, S, `{{ var }}`, emoji buttons are decorative and do nothing), textarea with a "N / 1024" counter (server limit is 4096), help "Use _bold_ / _italic_ / ~strike~ / {{ name }}". Pre-filled with a demo greeting. The live preview mirrors typing.
  - Image: drop zone (label copy "JPG, PNG, WEBP / max 5 MB", accepts jpeg/png/webp in the picker), filename display, Caption textarea.
  - Document: drop zone ("PDF, DOCX, XLSX / max 100 MB"; picker accepts pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv), plus a "Filename shown to recipient" input that has no id or name and is never submitted (dead control).
  - Video: drop zone ("MP4, 3GP / max 16 MB, up to 30 s"; picker mp4/3gp), Caption textarea.
  - Template: grid of the workspace's approved templates (name, an APPROVED chip, provider label for WABA, first 120 chars of body, category); none selected by default; empty state "No approved templates yet." with a Create one link; a "Browse all templates" link to `/templates`. Clicking a chip selects it and mirrors its composed text (header, body, footer) into the preview.
  - The wizard always submits exactly one primary variant: `contents[0]` with content_type = active tab, `is_selected=1`, `sort_order=0`.
- **Endpoints:** Part of store/update (`contents[]`, `outside_contents[]`, files at `contents[i][media]`).
- **Data:** `keyword_reply_contents`: `keyword_reply_id`, `content_type` (text, image, video, document, template), `variant_role` (primary or outside_hours), `content` (text or caption; ENCRYPTED at rest via Laravel `encrypted` cast), `content_translations` (JSON map, WD-AR-033), `file_path` (bare object path such as `auto-reply/<time>_<random24>.<ext>` on the media disk; legacy rows `uploads/auto-reply/...`), `original_name`, `file_size`, `mime_type`, `template_id`, `is_selected`, `sort_order`.
- **Rules & edge cases:**
  1. Upload guard (`SecureUpload`): extension allow-list (images jpg jpeg png gif webp bmp tiff; video mp4 webm mov 3gp mkv; docs pdf doc docx xls xlsx ppt pptx txt csv rtf zip; audio mp3 ogg opus m4a aac wav amr), an explicit block-list (php, html, svg, js, exe, etc.), and a sniffed-MIME allow-list; failure returns a validation error on the file key. File names are replaced by `time()_random24.ext`. NO size limit is enforced by the app (only PHP/webserver limits), despite the UI copy (QUIRK).
  2. The tab does not have to match the file kind: an "image" variant can carry a pdf.
  3. Caption fallback QUIRK: for image, video and document the submit code takes the tab's own caption, else a generic `media-cap`, else the TEXT tab's textarea. Because the text tab has a default greeting and documents have no caption box, an image posted with an empty caption is saved with the demo greeting as caption, and every document is saved with the text-tab value as its stored content (which the runtime ignores for documents).
  4. If no posted variant has `is_selected`, the first by sort_order is force-selected.
  5. The template variant stores only `template_id`; rendering is done at send time (see WD-AR-037, WD-AR-040). Template ids are NOT ownership-validated at save.
  6. Variant choice at runtime: only the first selected variant ordered by `sort_order` is ever sent. There is no random or round-robin rotation; extra variants (created through the API/CSV/mobile) are inert unless selected first.
  7. Outside-hours variants share the table with `variant_role='outside_hours'` and `is_selected=false` so they never enter the normal pool.
  8. Placeholders in text and captions: `{{name}}`, `{{first_name}}`, `{{last_name}}`, `{{mobile}}`, `{{phone}}`, `{{email}}` and workspace attributes `{{key}}` (see WD-AR-037).
  9. Editing a media rule requires re-uploading the file (see WD-AR-012 rule 7).
  10. Emoji, bold/italic toolbar buttons are inert; markup is sent as typed (WhatsApp interprets `*bold*`, `_italic_`, `~strike~`).
- **Async & events:** File written to the media disk synchronously during the request.
- **External systems:** Media disk (local `public` disk or Cloudflare R2, selected by `media_disk()`).
- **Settings:** Cloud storage setting (SET), PHP `upload_max_filesize`.
- **Acceptance criteria:**
  - Given the Text tab with a reply, when saved, then one variant of type text with the text is created and selected.
  - Given an Image tab with a png and a caption, when saved, then a variant with `file_path`, `original_name`, `mime_type`, `file_size` and the caption exists.
  - Given a file named `shell.php`, when uploaded, then the save fails with a "file type is not allowed" style validation error.
  - Given the Template tab with a chip selected, when saved, then `template_id` is stored and `content` is empty.
  - Given the Text tab is empty, when pressing Next on step 4, then "Write a reply message." blocks navigation.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (syncContents, syncOutsideContents, guessPrimaryMessageType), `app/Models/KeywordReplyContent.php`, `app/Support/SecureUpload.php`, `resources/views/user/auto-reply/create.blade.php`, `resources/js/charts/user-auto-reply-create.js`.
- **Port notes:** Upload media through the file-storage module (not present yet), store a file id, enforce declared size caps, and generate signed URLs for the bot. Keep encryption of message copy only if there is a real threat model (this repo has no field-level encryption pattern; if kept, encrypt at the application layer and give up SQL search). Support several variants with an explicit selection mode (first, random) if product wants it.

### WD-AR-024 — Reply type: run a flow

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AR-042
- **Summary:** Instead of a canned message the rule launches a published flow for the contact, handing the conversation to the flow builder.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Step 3 tile "Run a flow"; step 4 branch "Choose flow": a search box (filters by name), and a grid of cards (name, `#id`, updated date, PUBLISHED or DRAFT chip). One card selectable. Empty state "No active flows yet. Build one in the Flow Builder and come back here." with a link to `/flows/builder`. A note reminds that active flows of the workspace are listed.
- **Endpoints:** `reply_type=flow` and `flow_id` on store/update.
- **Data:** `reply_type='flow'`, `flow_id`. The stored row keeps `is_flow_trigger=0` (hand-made). Contents are not created.
- **Rules & edge cases:**
  1. `flow_id` required and must belong to a flow owned by a workspace member (`flows.user_id` in `workspace_user`), at create only.
  2. Only flows with `is_active = true` are offered, including unpublished drafts (badge DRAFT).
  3. At runtime a flow rule fires only if the flow is BOTH `is_active` and `is_published`; otherwise it returns not-allowed and the rest of the resolution stops (a paused or unpublished flow silences its keyword) (WD-AR-036).
  4. Baileys: the lookup returns `reply: "flow_triggered"`, `reply_type: "flow"`, `flow_id`, `cooldown`, `timeout`; Node starts the flow and applies `timeout` as the flow-session inactivity window (default 600 s) and `cooldown` after the session ends. A flow-trigger keyword always (re)starts the flow, even during cooldown or mid-flow.
  5. Dispatcher path: the contact (or a minimal contact created on the fly with name = conversation name or digits) is enrolled through `FlowEnrollmentService::enroll`; failures are logged and swallowed, and the fire is still recorded.
  6. Flow-typed responders (welcome/away with a flow) use the same paths; the outside-hours message is always plain content.
- **Async & events:** Flow runtime (FLR) executes asynchronously in Node.
- **External systems:** Node bridge flow endpoints (`/api/flows/{id}`, session store).
- **Settings:** None.
- **Acceptance criteria:**
  - Given a published, active flow and a rule pointing at it, when the keyword arrives, then the flow starts.
  - Given the flow is paused, when the keyword arrives, then nothing is sent and the lookup logs a non-match.
  - Given a flow id of another workspace, when creating, then 422.
  - Given the search box "welc", then only flow cards with names containing it stay visible.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (lookup flow branch), `app/Services/Inbox/KeywordReplyDispatcher.php` (flow branch, findOrMakeContact), `resources/views/user/auto-reply/create.blade.php`, `node/classes/BaileysClientManager.js`, `node/controllers/providerFlowController.js`.
- **Port notes:** Validate `flow.workspace_id` (not member ownership); emit an outbox event `flow.enrolment_requested` handled by the flow runtime worker instead of calling the flow service inline.

### WD-AR-025 — Reply type: share a contact card

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AR-010
- **Summary:** The rule replies with a saved contact's vCard so the customer can tap to call or save it.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Step 3 tile "Share a contact" (hidden for Instagram senders); target select "Contact to share" listing up to 500 workspace contacts ordered by name (name, or first/last name, or masked mobile, plus mobile). Required before leaving step 3. Help "The customer receives this contact's vCard".
- **Endpoints:** `reply_type=share_contact`, `target_contact_id` (required if that type, integer).
- **Data:** `target_contact_id`. Save-time check: the contact belongs to a workspace member (`contacts.user_id`).
- **Rules & edge cases:**
  1. Baileys: lookup returns `reply: "contact_shared"` with `contact {name, phone digits (country_code+mobile), email}`; Node builds a WhatsApp contacts message (vCard 3.0 with waid) and sets the cooldown. The contact is re-checked against `reply.workspace_id`; if missing the resolution silently continues to the custom branch and ends with no reply.
  2. Dispatcher path (WABA, Twilio, channels): no native card builder, so it sends a text "Name, +number" card only if the target belongs to the same workspace.
  3. Name fallback: contact `name`, else first + last, else phone.
- **Async & events:** None.
- **External systems:** WhatsApp contacts message via Baileys.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a share_contact rule, when the keyword arrives on a Baileys number, then the customer receives a contact card.
  - Given the same rule on a WABA number, then the customer receives a text with name and number.
  - Given the target contact was deleted, then no reply is sent.
  - Given no contact chosen, when leaving step 3, then "Pick a contact to share." blocks.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (lookup share_contact), `app/Services/Inbox/KeywordReplyDispatcher.php`, `node/classes/BaileysClientManager.js`, `resources/views/user/auto-reply/create.blade.php`.
- **Port notes:** Use the contacts module (CON) for the picker (search, not a 500 list). WABA supports a native contacts message type; use it instead of text.

### WD-AR-026 — Reply type: send a catalog

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AR-010
- **Summary:** The rule replies with the workspace's WhatsApp product catalog. The UI promises a Product List (MPM) bubble, but the Baileys path sends only a plain link and the dispatcher path sends a generic text.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Step 3 tile "Send a catalog" (hidden for Instagram); target select "Catalog to send" listing the workspace's `wa_catalogs` ordered by name (name or `#id`, provider upper-case). Required. Help text describes a Product List bubble.
- **Endpoints:** `reply_type=send_catalog`, `target_catalog_id` (required if that type).
- **Data:** `target_catalog_id`; must belong to a `wa_catalogs` row with the current `workspace_id` at save.
- **Rules & edge cases:**
  1. Baileys: lookup returns `reply: "catalog_sent"`, `catalog {catalog_id, provider, mode: "mpm"}`; Node sends the text "Here's our catalog: https://wa.me/c/<catalog_id>" (its TODO says a real product-list message is future work) and sets the cooldown.
  2. Dispatcher: sends the rule's first text variant if one exists (custom-style), otherwise "Thanks! Our product catalog is on its way to you shortly." (no catalog is actually sent) (QUIRK).
  3. Catalog is re-checked against the rule's workspace at lookup.
- **Async & events:** None.
- **External systems:** WhatsApp catalog link.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a send_catalog rule on a Baileys number, when triggered, then the customer receives the wa.me catalog link.
  - Given a catalog of another workspace, when saving, then 422.
  - Given the catalog was deleted, then no reply is sent.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php`, `app/Services/Inbox/KeywordReplyDispatcher.php`, `node/classes/BaileysClientManager.js`.
- **Port notes:** Build a real multi-product message on WABA (CAT/WABA modules); only fall back to the link for unofficial connections.

### WD-AR-027 — Reply type: request location

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AR-010
- **Summary:** The rule asks the customer to share their location using WhatsApp's location-request prompt.
- **Actors & access:** Workspace admin/owner.
- **UX & screens:** Step 3 tile "Request location" (hidden for Instagram); an info panel says no configuration is needed and the reply will arrive with lat/lng.
- **Endpoints:** `reply_type=request_location`; no target.
- **Data:** none beyond `reply_type`.
- **Rules & edge cases:**
  1. Baileys: lookup returns `reply: "location_requested"`; Node sends a native `requestLocationMessage` with body "Please share your location" (hard-coded) and sets the cooldown.
  2. Dispatcher: sends the rule's own first text if present, else "Could you please share your location so we can help you better?".
  3. The customer's reply location is handled by inbound processing (CHAT/TIB1), not this domain.
- **Async & events:** None.
- **External systems:** WhatsApp location request.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a request_location rule, when triggered on Baileys, then the location-request prompt is sent.
  - Given the same rule on WABA, then the fallback text is sent.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php`, `app/Services/Inbox/KeywordReplyDispatcher.php`, `node/classes/BaileysClientManager.js`.
- **Port notes:** WABA has an interactive `location_request_message`; use it.

### WD-AR-028 — Instagram-native triggers

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AR-039
- **Summary:** When the sender is an Instagram account, a rule chooses which Meta event fires it: a DM containing a keyword, a comment on a post (answered in DMs), a reply to a story, a mention of the account in someone's story, or an @mention in a comment or caption.
- **Actors & access:** Workspace admin/owner; requires a connected Instagram account (Instaflow install).
- **UX & screens:** In Step 1 the trigger tiles swap to five IG tiles (DM keyword, Comment to DM, Story reply, Story mention, Mention) with a pink info note that changes with the tile. Story mention and Mention hide the keyword and match-method blocks. WhatsApp-only reply types are hidden. WhatsApp trigger tiles and responder panels are hidden and the trigger type is forced to keyword.
- **Endpoints:** `ig_trigger` on store/update (nullable in dm_keyword, comment_to_dm, story_reply, story_mention, mention; the wizard sends an empty string for non-IG rules).
- **Data:** `keyword_replies.ig_trigger` varchar(24) nullable, indexed. `provider='instagram'`, `device_id` = Instaflow account id. For story_mention and mention the wizard sets `is_catch_all=1` so the "keyword required" rule passes.
- **Rules & edge cases:**
  1. Dispatcher scoping: when the IG webhook passes a trigger, candidates are limited to rules with the same `ig_trigger`; for `dm_keyword` legacy rules with a NULL or empty `ig_trigger` also qualify. With no trigger context (WhatsApp, or IG without one) only rules with NULL, empty or `dm_keyword` `ig_trigger` are considered, so a story rule can never fire on a plain DM.
  2. No-keyword triggers (`story_mention`, `mention`) skip keyword matching entirely and take the first candidate; the body may be empty.
  3. Instagram-only cardinality: one IG account per rule (the picker clears other boxes).
  4. Comment-to-DM: rules authored here are also selectable by the Flow builder's comment_to_dm trigger (FLB); that screen filters by status equal to the string `active`, which never matches the boolean column, so every rule appears inactive there (QUIRK in FLB).
  5. Instagram rules are visible in the list only while an IG account is connected (WD-AR-001 rule 1).
  6. The Baileys lookup does not apply IG scoping; an IG rule's `device_id` (an Instaflow account id) could collide with a Baileys `devices.id` in the same workspace and fire on WhatsApp (QUIRK, WD-AR-032).
- **Async & events:** Instaflow ingest calls the dispatcher per IG event (IG domain).
- **External systems:** Instagram Graph via the Instaflow install (IG domain); credentials there.
- **Settings:** None here.
- **Acceptance criteria:**
  - Given an IG sender is ticked, when the admin opens Step 1, then the five IG tiles are shown and the WhatsApp trigger tiles are hidden.
  - Given a story_reply rule and a plain DM containing the keyword, then the rule does not fire.
  - Given a story_mention rule, when someone mentions the account in a story, then the reply is sent regardless of text.
  - Given a legacy IG rule with no `ig_trigger`, when a DM matches its keyword, then it fires as dm_keyword.
- **Source refs:** `app/Models/KeywordReply.php` (IG_TRIGGERS), `app/Services/Inbox/KeywordReplyDispatcher.php`, `app/Services/Instaflow/InstaflowIngestService.php`, `resources/views/user/auto-reply/create.blade.php`, `resources/js/charts/user-auto-reply-create.js`, `database/migrations/2026_08_07_000000_add_ig_trigger_to_keyword_replies.php`, `app/Http/Controllers/FlowsController.php`.
- **Port notes:** IG channel module owns event ingestion; this domain should expose a `resolve(event)` service taking `{channelAccountId, eventKind, text}`.

### WD-AR-029 — Plan feature flag, rule cap, role gate and paywall overlay

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** Auto Reply is a plan feature: a boolean package flag turns the whole feature on or off and a numeric cap limits how many rules a workspace may have. Only workspace admins/owners (or platform admins) may use the pages.
- **Actors & access:** Role gate `workspace.role:admin` (hierarchy owner > admin > manager > agent > viewer). Plan flag `access_keyword_replies` (boolean package column, default true, on for all seeded plans), cap `autoreply_limit` (integer package column; seeded Starter = 1, other seeded plans use the default 0 meaning unlimited; the guard treats null, 0 and negative as unlimited). Per-workspace `plan_overrides` and purchased add-ons stack on top through `Workspace::effectiveLimit`. Platform admins and admin-owned workspaces bypass every check. A separate legacy boolean `autoreply` package column ("Auto-reply system") is displayed in admin and reported by the mobile content API but enforces nothing here.
- **UX & screens:** The nav item "Auto-reply" is in the admin-tier group (no `feature` key, so it is not hidden by plan). The `/more` card shows a plan crown icon for `access_keyword_replies`. When the flag is off the pages show the shared upgrade paywall sheet (config glob map). Mutations return the plan-limit error.
- **Endpoints:** Affects every route of this domain. Plan errors are `PlanLimitReachedException`: JSON (422) `{ok:false, error:"plan_limit_reached", reason:"feature_disabled"|"limit_reached", key, used, limit, message}` for JSON requests, else a redirect back with an error flash. Messages: feature disabled: "This feature isn't available on your current plan. Upgrade to unlock it."; cap: "You've reached your plan's limit of N auto-reply rules. Upgrade your plan to add more, or delete an existing one to free up space.".
- **Data:** `packages.access_keyword_replies`, `packages.autoreply_limit`, `packages.autoreply`, `workspaces.plan_overrides`.
- **Rules & edge cases:**
  1. Feature gate applied on: store, update, toggle, destroy, bulk, import, away-mode. NOT applied on: index, create, keyword (analytics), demo-csv, and NOT on the bot lookup or the dispatcher, so a workspace whose plan lapses keeps auto-replying to customers (QUIRK).
  2. Cap applied only on store (count of the workspace's rules before fan-out; includes flow-managed rules); not on import or update fan-out.
  3. Platform admin bypass: Spatie roles Super Admin/Admin or legacy `users.role` admin.
  4. A downgraded workspace cannot even delete its rules (delete is feature-gated).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** Package editor at `/admin/packages` (PLAN) exposes both keys ("Keyword auto-replies" cap and flag).
- **Acceptance criteria:**
  - Given `access_keyword_replies` off, when an admin POSTs a new rule, then 422 with reason `feature_disabled`.
  - Given a cap of 1 and one rule, when creating a second, then the limit message is returned; deleting the first frees the slot.
  - Given a platform admin, when creating rules past any cap, then it succeeds.
  - Given a manager-role user, when opening `/auto-reply`, then 403.
- **Source refs:** `app/Services/PlanLimitGuard.php`, `app/Exceptions/PlanLimitReachedException.php`, `app/Models/Package.php`, `app/Models/Workspace.php` (effectiveLimit), `app/Http/Middleware/EnsureWorkspaceRole.php`, `config/plan_gates.php`, `routes/web.php`, `database/seeders/PackageSeeder.php`, `app/Support/UserNav.php`.
- **Port notes:** Use the repo's plan/entitlement layer (PLAN) with a `usage.autoReply.rules` limit and a `auto_reply` feature key; add a permission such as `autoreply.manage` in RBAC instead of a hard-coded role. Decide whether lapsed plans should keep answering customers (WaDesk does).

### WD-AR-030 — Bot lookup endpoint: token auth, request contract, device and workspace resolution, audit row

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-AR-029
- **Summary:** The Node bridge asks Laravel "what should I answer to this inbound?" on every inbound text (and for image/voice orders). The endpoint identifies the receiving number and workspace, decides a reply and returns a small JSON array. It is the runtime heart of the Unofficial (Baileys) path and is also called by the Node provider-flow bridge for WABA/Twilio to start flows.
- **Actors & access:** Machine caller only (Node bridge). Guarded by the shared secret header `X-Node-Token` compared with `hash_equals` against `node_token()` (system setting `node_webhook_token`, else legacy `baileys_callback_token`, else `.env NODE_WEBHOOK_TOKEN`). An unset/empty configured token rejects every call (fail closed). Not session-authenticated, no plan check, no rate limit beyond the `api` middleware group.
- **UX & screens:** None.
- **Endpoints:**

| Method uri              | Route name             | Action                     | Middleware | Request                                                                                                                                                                                              | Response                                                                                                                                                                                                                                                         |
| ----------------------- | ---------------------- | -------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET api/keyword-replies | keyword-replies.lookup | AutoReplyController@lookup | api        | query `keyword` (inbound text), `phone` (the receiving DEVICE number), `mobile` (the CUSTOMER identifier, e.g. `919...@s.whatsapp.net`; defaults to `phone`), optional `media_type` (image or audio) | 200 JSON array with one object `{response:"200", reply, reply_type, flow_id, cooldown, timeout, ...}`; not-allowed shape `[{response:"200", reply:"notallow", reply_type:null, flow_id:null}]`; auth failure 401 `[{response:"401", reply:"unauthorized", ...}]` |

- **Data:** Writes one `auto_reply_lookups` row for EVERY call that passes auth (including no-match and early exits): `device_id` (resolved device or null), `matched_keyword_reply_id`, `contact_phone` (the `mobile` value, encrypted), `query_text` (raw keyword, encrypted), `latency_ms` (server-side milliseconds since the call started, minimum 0), `created_at`. `workspace_id` on that table is never set by this code (not in fillable) (QUIRK). Insert failures are swallowed.
- **Rules & edge cases:**
  1. Early exits returning not-allowed (each still writes an audit row with nulls): empty `phone`; empty keyword AND not a media-order; no device found.
  2. Media order: empty keyword with `media_type` image or audio proceeds (so a photo or voice order can start the device's order flow, WD-AR-032 step 9).
  3. Storefront cart capture: before any matching, the raw lowercased text is passed to the storefront order parser for the owning workspace (resolved from a Baileys `wa_provider_configs` row whose phone digits or raw value equals `phone`). Best-effort, exceptions swallowed. A cart-shaped message creates an order (STORE) regardless of rules.
  4. Device resolution (encrypted phone, so done in PHP): scan active `devices` (restricted to the owner's workspace or NULL-workspace rows when the owner config is known, else ALL active devices platform-wide) and match digits of `country_code + phone_number` OR of `phone_number` to the digits of `phone`. If none, scan `wa_provider_configs` for provider waba or twilio with equal phone digits and build a stand-in `{id, workspace_id, user_id, provider}`.
  5. Workspace resolution order: owner config workspace, else device workspace, else the device user's `current_workspace_id`. Member user ids = workspace members plus the device user (for legacy NULL-workspace rules).
  6. Rule scoping ("candidate scope") used by every keyword stage: rules with `device_id` = resolved device AND (`workspace_id` = resolved workspace OR (workspace NULL and user is a member)); OR rules with `device_id` NULL in the resolved workspace. If no workspace is resolvable it falls back to member-user scoping, and to nothing at all when there are no members (never unscoped). No provider filter is applied (QUIRK: cross-channel id collisions).
  7. Every response is a JSON array with a single element; Node reads element 0.
  8. The endpoint writes very verbose logs (`[KW-LOOKUP]`) including a dump of ALL active rules of the whole platform on every call, and raw device phone numbers; phone masking helper is a pass-through in this build. Do not port.
  9. `cooldown` and `timeout` in the response are the rule's raw columns (null when unset).
- **Async & events:** Synchronous request from Node; typical latency budget 1.5 s (the analytics page uses that as "target"). No queue.
- **External systems:** Node bridge (caller). Translation providers on the fallback path (WD-AR-033).
- **Settings:** System settings `node_webhook_token`, `baileys_callback_token`; env `NODE_WEBHOOK_TOKEN` (must equal node/.env value).
- **Acceptance criteria:**
  - Given a wrong or missing `X-Node-Token`, when called, then 401 with the unauthorized shape and no audit row.
  - Given an unknown device phone, when called with valid token, then the not-allowed shape and an audit row with null device.
  - Given a valid device and a matching rule, when called, then the response carries the rule's reply and an audit row links `matched_keyword_reply_id`.
  - Given an empty keyword and `media_type=image` on a device with a flow rule, then the flow is returned (WD-AR-032).
  - Given `phone` empty, then not-allowed.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (lookup), `routes/api.php`, `app/Models/AutoReplyLookup.php`, `app/Support/fc_helpers.php` (node_token), `node/classes/BaileysClientManager.js` (checkKeywordReply), `node/controllers/providerFlowController.js`.
- **Port notes:** Implement as an internal service call (`AutoReplyResolver.resolve(inboundEvent)`) invoked by the inbound pipeline worker, not an HTTP endpoint with a shared secret; where Node must call over HTTP use an authenticated internal route with per-tenant scoping by an explicit `channelAccountId` (never by scanning devices by phone). Write the audit row asynchronously (outbox) and include `workspace_id`.

### WD-AR-031 — Keyword matching semantics: candidate query, exact, contains, fuzzy, regex

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-013
- **Summary:** The precise rules that decide whether an inbound text triggers a keyword rule. Both runtime paths use the same two-step approach: a coarse SQL candidate query, then a confirming in-memory check per rule.
- **Actors & access:** Internal.
- **UX & screens:** None.
- **Endpoints:** Used by WD-AR-030 and WD-AR-039.
- **Data:** Reads `keyword_replies.keyword`, `matching_method`, `fuzzy_similarity`, `is_catch_all`, `status`.
- **Rules & edge cases:**
  1. Candidate SQL (`matchKeyword`): excludes `is_catch_all` rows; then keeps rows where LOWER(keyword) LIKE `%needle%` (needle lower-cased, trimmed, LIKE wildcards escaped) OR (`matching_method = contains` AND needle LIKE `%keyword%`, keyword used raw inside LIKE so `%`/`_` in stored keywords act as wildcards) OR (`matching_method = regex`, all regex rows are always candidates).
  2. Confirmation (`matchesNeedle`, per rule): regex: the whole keyword field is ONE pattern, wrapped as `~pattern~iu` (literal `~` escaped), case-insensitive and unicode, tested with a search (unanchored); on a PCRE error it retries without the `u` flag; invalid patterns simply never match. Regex ignores comma splitting and runs against the inbound text as passed (the Baileys lookup passes the lower-cased text, the dispatcher passes the raw trimmed text; the `i` flag makes them equal).
  3. Non-regex: the needle is lower-cased and trimmed (empty = no match); the keyword field is split on commas, each token trimmed and lower-cased, empties dropped; no tokens = no match.
     - exact: needle equals one token.
     - contains: any token appears in the needle as a WHOLE WORD/phrase, using Unicode look-arounds so letters and digits are word characters (so "hi" matches "hi there" and "oh hi!" but not "this", "shipping" or "Delhi"); on a regex failure it falls back to plain substring.
     - fuzzy: PHP `similar_text(needle, token)` percentage (2 x common chars / (len1 + len2) x 100, byte-based longest-common-substring recursion) is >= `fuzzy_similarity` (clamped 0..100, default 80) for any token.
  4. Because the SQL step requires the keyword column to contain the needle as a substring (except contains-reverse and regex), a fuzzy rule with a typo ("pricng" against "pricing") is filtered out BEFORE the confirmation step; typos only match through the separate fuzzy fallback stage of the Baileys lookup (WD-AR-032 step 8), which does not exist on the dispatcher path (QUIRK: fuzzy typo matching is broken on WABA/Twilio/channels).
  5. Exact matching therefore also requires the SQL substring test to pass, which it always does for a true equality.
  6. All matching is Unicode-safe for lower-casing (`mb_strtolower`) but fuzzy uses byte-based `similar_text`, so non-ASCII fuzzy scores are skewed.
  7. When several candidates match, the first in database order wins (no ORDER BY, effectively lowest id); rule `priority` is ignored here.
  8. Reply-side effects of a match are elsewhere; a match on a rule of type flow still requires the flow to be live (WD-AR-036).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given keyword "hi, hello" with Exact, when a customer sends "Hello", then it matches; "hello there" does not.
  - Given keyword "hi" with Contains, when a customer sends "this is shipping", then it does not match; "hi there" does.
  - Given keyword "price|cost" as Regex, when a customer sends "What is the COST?", then it matches.
  - Given an invalid stored regex, then it never matches and never errors.
  - Given Fuzzy 80 with "pricing" on the dispatcher path and a customer message "pricng", then it does not match (documented behavior to be improved in the port).
- **Source refs:** `app/Models/KeywordReply.php` (scopeMatchKeyword, matchesNeedle, regexMatches, isValidRegex), `app/Http/Controllers/AutoReplyController.php`, `app/Services/Inbox/KeywordReplyDispatcher.php`.
- **Port notes:** Implement as a pure function in `packages/shared` (or the module) with a golden test table from the criteria above. Use RE2 for regex, `pg_trgm` or a Levenshtein/Dice implementation for fuzzy (choose one and document the deviation from `similar_text`), and do fuzzy against tokens without the SQL pre-filter so typos work on every channel.

### WD-AR-032 — Lookup resolution order and tie-breaking

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-030, WD-AR-031
- **Summary:** The exact order in which the Baileys lookup tries rule kinds; the first stage that yields a rule wins and later stages are skipped. This order is what operators experience as "which rule wins".
- **Actors & access:** Internal.
- **UX & screens:** None.
- **Endpoints:** WD-AR-030.
- **Data:** As WD-AR-031.
- **Rules & edge cases:** Order of stages after device and workspace are resolved:
  1. Flow-builder inbound conditions: `FlowEnrollmentService::onInboundMessage(workspace, customerDigits)` runs (away or out-of-hours flow triggers; best-effort) before any rule.
  2. Welcome pass (WD-AR-034).
  3. Away pass (only if the workspace is away).
  4. Out-of-hours pass.
  5. Keyword race: candidates = candidate scope, `status = true`, `trigger_type` NOT in welcome/away/out_of_hours, SQL candidate filter (WD-AR-031); first candidate whose `matchesNeedle` is true. A rule found by an auto-responder pass is never replaced by a keyword.
  6. Stored translations: if still none, rules with non-null `keyword_translations` are scanned; a rule hits when any stored translation equals the text (case-insensitive), or, for contains rules, appears as a plain SUBSTRING of it (not whole-word). The hit language becomes the detected language.
  7. Live translation: if still none and text is non-empty, one call detects the language and translates to English (24 h cache). If the detected language is not English and a translation exists, the rules are re-queried with the English text through the SQL candidate filter ONLY (no confirmation step and no `trigger_type` exclusion), taking the first row (QUIRK: any regex rule in scope is a candidate and would match any foreign-language message; substring matches count for exact rules).
  8. Fuzzy fallback: candidate-scope rules with `matching_method = fuzzy`; the first whose `similar_text(lower(entire keyword string), lower(text))` percentage, rounded, is >= `fuzzy_similarity`. The whole comma-joined keyword string is compared, not tokens, and no `trigger_type` or catch-all exclusion applies.
  9. Media-order fallback: empty text with `media_type` image or audio picks the first active `flow` rule in scope with a flow id that is NOT catch-all, preferring a rule bound to this device over a workspace-wide one.
  10. Default route (catch-all), text only: first active `is_catch_all` rule in scope, device-bound before workspace-wide, then lowest id.
  11. No rule: not-allowed, audit row without a match.
  12. With a rule: flow liveness (flow rules), billing check, counters and log (WD-AR-036), then the payload (WD-AR-037).
  - There are three separate "first row wins" points (5, 7, 8) and none uses rule priority.
  - Keyword stages have no provider filter; only `device_id` and workspace.
- **Async & events:** Translation calls go to the configured provider chain (I18N) synchronously; expect up to ~0.5 s on the first message in a new language.
- **External systems:** Translation providers (MyMemory, Google GTX, LibreTranslate, DeepL, Google Cloud) through `Translator`.
- **Settings:** Translation provider activation (I18N).
- **Acceptance criteria:**
  - Given a welcome rule and a keyword rule that both match a brand-new customer's "hi", then only the welcome greeting is sent.
  - Given rules "book" (flow) and a catch-all, when the customer types "book me", then the flow rule wins; when they type "asdf", the catch-all wins.
  - Given a keyword rule bound to device A and one to no device, both matching, then the lower id wins (device binding is not a priority tier for keyword rules).
  - Given a Korean message equal to a stored translation of "hello", then the rule fires with detected language ko.
  - Given a photo with no caption and an order-flow rule, then that flow starts.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (lookup), `app/Models/KeywordReply.php`, `app/Services/Flow/FlowEnrollmentService.php` (onInboundMessage).
- **Port notes:** Build the resolver as an ordered list of "tier" strategies (`welcome, away, out_of_hours, keyword, translated_keyword, fuzzy, media_order, default_route`), each returning a rule or null, with `(tier, priority, sender-specific first, id)` ordering. Emit a structured trace of which tier matched instead of dumping logs. Filter by channel account explicitly.

### WD-AR-033 — Multilingual fallback and reply-language selection

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-AR-032
- **Summary:** A customer writing the keyword in another language still triggers the rule, and the reply is delivered in the customer's language. Nothing is translated when the rule is saved; translation happens lazily at runtime and is cached for 24 hours.
- **Actors & access:** Automatic; no per-rule switch. Not plan-gated.
- **UX & screens:** None in this domain (workspace language settings and provider admin belong to I18N/WSP).
- **Endpoints:** Part of WD-AR-030.
- **Data:** Reads `keyword_replies.keyword_translations` (JSON `{lang: text}`, normally NULL for new rules), `canonical_language` (varchar 8, default en), `keyword_reply_contents.content_translations` (JSON), `workspaces.default_language`, `workspaces.auto_translate_languages`. Writes `keyword_reply_logs.detected_language` (see rule 6).
- **Rules & edge cases:**
  1. Matching: stored translations first, then live detect-and-translate to English (WD-AR-032 steps 6-7). English inbound text skips the live stage.
  2. Language detection for the reply: the language of the stored-translation hit, else the language from the live stage, else a Unicode-script detector on the raw text (Hangul to ko, Devanagari to hi, Arabic, CJK, Cyrillic etc.; Latin script cannot be distinguished, so it returns the workspace `default_language` or en).
  3. Reply text selection (`pickContent`): if detected language is empty or the variant content is empty, use the canonical text; if the variant's `content_translations` has that language, use it; if the detected language equals the rule's canonical language, use the canonical text; otherwise translate canonical to the detected language live (24 h cache), falling back to the canonical text on failure. Applies to text bodies and media captions, never to file names or documents.
  4. Live translation goes through `Translator` (common-phrase dictionary, 24 h cache keyed by text, then the active driver chain with fallback, usage ledger). Latin-script languages (es, fr, de, pt...) are only recognised when the live provider detects them or when a stored translation matched; the script detector alone never returns them.
  5. Failures degrade to the canonical reply in the canonical language.
  6. QUIRK: the detected language is passed to `KeywordReplyLog::create`, but `detected_language` is not in the model's fillable list, so it is silently dropped and always NULL in the DB; the Baileys reply still uses it. The dispatcher path does no translation and never sets it.
  7. Translations stored per rule are only populated by the backfill command (WD-AR-044); a rule created in the UI has `keyword_translations = NULL` until then.
  8. Live translation of the canonical reply happens on every fire for non-canonical languages but is served from cache after the first.
  9. Live stage scope bug (QUIRK) documented in WD-AR-032 step 7.
- **Async & events:** Synchronous provider HTTP calls in the request path.
- **External systems:** Translation drivers (I18N); their credentials live in the admin translation providers table.
- **Settings:** `workspaces.default_language`, `workspaces.auto_translate_languages`, admin translation provider config, `translation.official_only` lockdown, workspace data residency (I18N).
- **Acceptance criteria:**
  - Given a rule with canonical keyword "pricing" and reply "Our plans...", when a customer writes the Spanish equivalent and the provider detects es, then the rule fires and the reply is translated to Spanish.
  - Given the provider is down, then the canonical English reply is sent (or no match for the keyword).
  - Given a second customer writes in the same language within 24 h, then no provider call is made (cache).
  - Given a Devanagari message and no translation, then detected language is hi for reply selection.
- **Source refs:** `app/Services/KeywordTranslationManager.php` (pickContent, targetsFor), `app/Services/Translator.php`, `app/Services/LanguageDetector.php`, `app/Models/KeywordReply.php` (matchesTranslation), `app/Http/Controllers/AutoReplyController.php`, `app/Models/KeywordReplyLog.php`, `database/migrations/2026_05_19_010000_multilingual_keyword_replies.php`.
- **Port notes:** Put translation behind the I18N module port (`TranslationPort.detectAndTranslate`), cache in Redis, run it in the resolver worker. Persist `detected_language` (fix the fillable drop). Decide whether to pre-translate at save time (async job) instead of live for latency.

### WD-AR-034 — Baileys auto-responder passes: welcome, away, out-of-hours, orphan self-heal

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AR-035
- **Summary:** Before keyword matching, the Baileys lookup tries the three keyword-less responder kinds using the same gate logic as the other engines, scoped to the receiving number and to the engine of the number.
- **Actors & access:** Internal.
- **UX & screens:** None.
- **Endpoints:** WD-AR-030.
- **Data:** Reads `keyword_replies`, `conversations` (by workspace and `contact_digits`), `contacts`, `devices`; writes `conversations.routing_meta.ar_fires`.
- **Rules & edge cases:**
  1. Provider filter uses the engine of the number the message ARRIVED on (a real `devices` row is always `baileys`; a `wa_provider_configs` stand-in carries waba or twilio), NOT the workspace default (fixed bug: on a WABA-default workspace Baileys away rules were excluded). Rules with NULL or empty provider always qualify.
  2. Sender scope: rules with `device_id` NULL, OR equal to the resolved device id, OR an ORPHANED binding (a `device_id` that is not any live device of the workspace, or any binding when the workspace has no live devices). Orphans are treated as workspace-wide because a reconnected Baileys number is re-inserted under a new device id and would otherwise be dead forever. This self-heal is NOT applied to keyword rules.
  3. The conversation is the newest `conversations` row for (workspace, customer digits); the contact is found by decrypt-scanning workspace contacts newest first. A missing conversation counts as "new".
  4. Order of tries within a kind: `priority` asc, then `id` asc; first rule whose evaluation says fire is returned; welcome/away/out-of-hours stop the whole resolution.
  5. Welcome with `use_outside` swaps the rule's outside-hours variant into place and forces a custom reply with that variant's content type.
  6. Firing stamps `routing_meta.ar_fires[ruleId]` on the conversation right away (before the message is actually delivered by Node).
  7. Customer digits come from `mobile` (fallback: the device digits). The device digits were once used by mistake, which broke first-contact detection; keep the customer id explicit.
  8. Away pass reads `workspaces.inbox_away` once and passes it to each evaluation.
  9. All passes are wrapped in a catch-all try; any exception is logged and the lookup falls through to keyword matching.
  10. WABA/Twilio caveat (QUIRK, verify live): for these engines the Node provider-flow bridge calls this same lookup for typed messages to look for flow triggers and ignores non-flow replies, but the passes here still stamp the resend window and write counters/logs. The dispatcher's own welcome pass (WD-AR-039) then sees the resend window as used and may skip the greeting. Whether the greeting is actually delivered on WABA/Twilio depends on that order; it has to be confirmed by a live parity test.
- **Async & events:** Updates conversation `routing_meta` inline.
- **External systems:** None.
- **Settings:** `workspaces.inbox_away`.
- **Acceptance criteria:**
  - Given an away rule bound to a device id that no longer exists in the workspace and one live device, when Away mode is on and a customer writes, then the away reply is sent.
  - Given a WABA-default workspace with a Baileys away rule, when a customer writes on the Baileys number with Away on, then the rule fires.
  - Given two welcome rules priority 2 and 1, then priority 1 is tried first.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (autoResponderReplyForBaileys), `app/Models/KeywordReply.php`, `app/Services/Inbox/AutoResponderEvaluator.php`.
- **Port notes:** Model sender identity properly so orphaned bindings cannot happen (rebinding on reconnect belongs to WADEV). Keep the "engine of the receiving number" rule.

### WD-AR-035 — Auto-responder gate evaluator

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** One service (`AutoResponderEvaluator`) holds all the gate logic for welcome, away, out-of-hours and (on the dispatcher path) matched keyword rules, so the Baileys and dispatcher paths decide the same way. Every gate fails open (allows) on error, except the away flag which fails closed.
- **Actors & access:** Internal.
- **UX & screens:** None.
- **Endpoints:** None.
- **Data:** Reads rule columns `cooldown`, `stop_on_agent_reply`, `resume_after`, `working_hours`, `excluded_numbers`, `excluded_group_ids`, `trigger_type`; reads `conversations.routing_meta.ar_fires` and `inbox_messages`; writes `routing_meta.ar_fires[ruleId] = ISO timestamp`.
- **Rules & edge cases:**
  1. Unit conversion `toSeconds(value, unit)`: value <= 0 or null = null; minute/minutes/min x60; day/days x86400; else hours x3600.
  2. Resend window: `cooldown` seconds if > 0; else 86400 for welcome, away and out_of_hours; else 0 for keyword rules.
  3. `resendAllowed`: true when no window, or no conversation, or no stored fire time for this rule, or the last fire is older than the window. Per-rule, per-conversation.
  4. `isExcluded`: see WD-AR-022.
  5. `workingHours`: see WD-AR-021. Not enabled means always in-hours.
  6. `agentPaused` (only when `stop_on_agent_reply` and a conversation exist): find the latest human outbound message (direction out, has `user_id`, `meta.source` not auto_reply/flow/keyword) among the last 25 outbound by id; none = not paused. If the rule has a recorded fire time and that agent reply is OLDER than it, not paused (our reply is newer). Resume window = `resume_after` or 24 h. Look at the two latest inbound messages; the gap between now and the PREVIOUS inbound (the current one is already stored); paused if the gap < resume window; no previous inbound = not paused.
  7. `isFirstContact` (welcome only): no conversation, or at most one inbound and zero outbound messages.
  8. Combined gates and their reason codes: welcome = excluded, agent_paused, not_new_conversation, resend_window, then hours (inside: fire; outside+send: fire with outside message; outside+none: silent `outside_hours_silent`); away = not_away, excluded, agent_paused, resend_window; out_of_hours = excluded, agent_paused, resend_window, no_hours_configured, within_hours, else fire. Out-of-hours fires with the primary variant (`use_outside` false).
  9. `stampFire` writes the fire time; it is called when the responder is chosen (Baileys) or after a successful build (dispatcher).
  10. Fire tracking is per conversation, so a new conversation row for the same person (or a merged/deleted one) resets the window.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a welcome rule with resend 1 hour and a fire 30 minutes ago on this conversation, then `resend_window` blocks it.
  - Given agent-override on, an agent replied after the last fire, and the customer's previous message was 5 minutes ago with resume 1 hour, then the rule is paused.
  - Given the same setup but the previous customer message was 2 hours ago, then it is not paused.
  - Given an error reading messages, then the gate allows.
  - Given overnight hours 22:00-06:00 and now 03:00, then in-hours.
- **Source refs:** `app/Services/Inbox/AutoResponderEvaluator.php`, `app/Models/KeywordReply.php`.
- **Port notes:** Port as a pure, unit-testable module with an injected clock; persist fire times in `auto_reply_fires`; base "human agent reply" on a message `sender_kind` column instead of `user_id` + meta.source heuristics.

### WD-AR-036 — Lookup post-match: flow liveness, billing check, counters, fire log

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-032
- **Summary:** Once a rule is chosen, the lookup checks that a flow target is live, runs the plan/wallet check, records the fire in three places and only then builds the reply.
- **Actors & access:** Internal.
- **UX & screens:** Feeds the KPI cards and analytics (WD-AR-001, WD-AR-043).
- **Endpoints:** WD-AR-030.
- **Data:** Writes `keyword_replies.last_triggered_at` and `trigger_count` (+1 via increment, after a forceFill save), `keyword_reply_logs` (`keyword_reply_id`, `content_id` = first selected variant id, `contact_phone` = the raw `mobile` value incl. `@s.whatsapp.net` suffix, encrypted; `matched_text` = raw inbound text, encrypted; `matched_variant` = the first 64 characters of the lower-cased inbound text; `fired_at`), `auto_reply_lookups` (WD-AR-030).
- **Rules & edge cases:**
  1. Flow liveness: a `flow` rule with a `flow_id` fires only if that flow is `is_active` AND `is_published`; otherwise not-allowed with an audit row that has no match, and resolution does NOT fall through to another rule.
  2. Billing: computes messages sent this month (workspace inbox outbound bubbles plus legacy `messages` outbound of workspace members) on every match, then calls `OverflowBilling::consumeOne(workspace, used)`. With the default system setting `wallet_billing_on_delivery = 1` that call returns immediately (delivery-time billing owns the charge); with 0 it applies plan-quota-first then wallet overflow and may throw `PlanLimitReachedException`. On the exception the response is not-allowed with extra `reason: "plan_limit"`, an audit row that DOES record the matched rule id, and no counter bump or log.
  3. Counters and logs are written after billing passes and BEFORE the reply is built; a payload that later turns out empty (missing variant, deleted contact/catalog) still counts as a fire (QUIRK).
  4. `matched_variant` is intended to be "which keyword spelling matched" but holds the whole (truncated) inbound text, so the analytics "variant breakdown" groups by full message text (QUIRK).
  5. `contact_phone` in this table is a WhatsApp JID (Baileys) while the dispatcher path stores plain digits, so the same customer shows up in two formats.
  6. All log writes are best-effort (exceptions swallowed); the reply path never fails because of logging.
  7. Rule with `reply_type=flow` returns before contents exist.
  8. Docs claim "charges one message credit to the wallet"; in this build that is delivery-time billing owned by WALLET.
- **Async & events:** Wallet/Node billing on delivery (WALLET).
- **External systems:** None.
- **Settings:** System setting `wallet_billing_on_delivery` (default 1), `bsp_pay_per_message`, package `monthly_messages_limit` (only relevant when send-time billing is on).
- **Acceptance criteria:**
  - Given a flow rule whose flow is unpublished, when the keyword arrives, then the response is not-allowed and no counter changes.
  - Given a matched rule, when the lookup returns, then `trigger_count` increased by one and one `keyword_reply_logs` row exists.
  - Given send-time billing on, an exhausted plan and an empty wallet, then the response is not-allowed with reason plan_limit and the audit row still points at the rule.
  - Given a logging failure, then the reply is still returned.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (lookup), `app/Services/OverflowBilling.php`, `app/Models/KeywordReplyLog.php`.
- **Port notes:** Do the counter/log writes in one transaction via the outbox after the send decision, keyed by an idempotency id so retries do not double count. Keep `matched_token` (which comma token matched) distinct from the text.

### WD-AR-037 — Lookup reply payloads and placeholder resolution

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-036
- **Summary:** How the lookup turns the chosen rule into the JSON the bridge sends: per reply type, plus text, media and template rendering with placeholder substitution.
- **Actors & access:** Internal.
- **UX & screens:** None.
- **Endpoints:** WD-AR-030 response element:
  - flow: `{response:"200", reply:"flow_triggered", reply_type:"flow", flow_id, cooldown, timeout}`.
  - share_contact: `reply:"contact_shared"`, `reply_type:"share_contact"`, `contact{name, phone(digits of country_code+mobile), email}`, cooldown, timeout.
  - send_catalog: `reply:"catalog_sent"`, `reply_type:"send_catalog"`, `catalog{catalog_id, provider, mode:"mpm"}`, cooldown, timeout.
  - request_location: `reply:"location_requested"`, `reply_type:"request_location"`, cooldown, timeout.
  - custom: `reply` (string: plain text, or a JSON-encoded media descriptor), `reply_type:"custom"`, `flow_id:null`, cooldown, timeout, `reply_delay` (int seconds = `timeout` or 0), `detected_language`.
  - Not-allowed when nothing to send.
- **Data:** Reads selected content variants, contacts, catalogs, templates, workspace attributes.
- **Rules & edge cases:**
  1. Custom reply uses the FIRST selected variant by `sort_order`; if none, not-allowed (after counters were already bumped, QUIRK).
  2. Text: `pickContent` for language (WD-AR-033), then placeholders.
  3. Image/document/video with a stored file: JSON with `type`, `url`, `filename` (original name or basename), `mimetype`, `caption` (empty for documents). URL: legacy `uploads/...` paths via app URL, otherwise `media_url()` on the active media disk. The caption is the resolved plain text only (a fixed bug wrapped the whole descriptor into the caption).
  4. Media variant with no `file_path` (for example after an edit without re-upload, or an imported media rule) falls into the generic formatter and returns a media JSON with `url: null` (QUIRK); the Node side requires a URL and would send nothing useful.
  5. Template variant: rendered to a sendable shape, never a Meta template: header text (only when the template has no media header) + body + footer joined by blank lines; placeholders resolved first from workspace attributes (positional `{{N}}` through the template's `variable_map`, named `{{key}}`), then from the contact (own fields then `custom_attributes`); unmapped placeholders stay literal. If the template has an image/video/document header file, the payload is a media JSON with the body as caption (document: `application/octet-stream`, no caption). Missing template, or a template of another workspace, returns an empty string (treated as no reply by Node).
  6. Text placeholder resolution (`resolveReplyText`): only runs when the text contains `{{`. Step 1 workspace attributes (`AttributeResolver`, named keys only, tolerant of spaces inside braces). Step 2, if the customer is a known contact (found by decrypt-scanning workspace contacts on digits of `mobile`, with or without country code), exact tokens `{{name}}`, `{{first_name}}`, `{{last_name}}`, `{{mobile}}`, `{{phone}}`, `{{email}}` are replaced (empty string when the field is empty) with NO space tolerance. Unknown contacts leave these tokens for the bridge to fill (WD-AR-038).
  7. `detected_language` is echoed to the bridge.
  8. `cooldown`/`timeout` are echoed verbatim on every type.
- **Async & events:** None.
- **External systems:** Media disk URL generation; workspace attributes table.
- **Settings:** Media disk / R2 public URL.
- **Acceptance criteria:**
  - Given an image variant with caption "Hi {{first_name}}" and a known contact "Sara Ali", then the reply JSON carries the file URL and caption "Hi Sara".
  - Given a template with body "Order {{1}}" and variable_map slot 1 -> order_id and a workspace attribute order_id = 55, then the reply is "Order 55".
  - Given text "Hi {{ name }}" (spaces) and a known contact, then Laravel leaves it and the bridge fills it from the WhatsApp profile name.
  - Given a rule with no selected variant, then not-allowed.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (lookup tail, formatVariant, renderTemplateReply, resolveTemplateContactVars, resolveReplyText), `app/Services/AttributeResolver.php`, `app/Services/KeywordTranslationManager.php`.
- **Port notes:** Produce a typed `OutboundMessageSpec` (text, media{fileId, caption}, contact, location_request, catalog, flow) that the channel adapter (WADEV/WABA modules) renders; do not use JSON-in-a-string. One placeholder engine, space tolerant, shared by all channels and the campaign/broadcast modules.

### WD-AR-038 — Node bridge consumption: cooldown, delay, send, inbox mirror

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-037
- **Summary:** What the Baileys bridge does with the lookup response. Owned by NODE, but rule behavior (cooldown, delay, restart semantics) is defined here.
- **Actors & access:** Internal (Node bridge process).
- **UX & screens:** None. The reply appears in the team inbox as an outbound bubble.
- **Endpoints:** Calls WD-AR-030; posts the mirrored outbound to `POST /api/inbound-message` (TIB1/NODE).
- **Data:** In-memory maps in Node: `userCooldowns[deviceNumber_customerNumber] = {endTime}`, `activeFlowSessions`.
- **Rules & edge cases:**
  1. Per inbound: if a flow session is waiting for input, a typed text equal to the session's trigger keyword or that resolves through the lookup to a flow restarts that flow instead of feeding the node; button/list taps are never treated as keywords.
  2. Otherwise Node calls the lookup; not-allowed/default or any error means no action.
  3. Flow reply: always starts/restarts the flow, even during cooldown; passes `timeout` (default 600 s) and `cooldown`.
  4. Non-flow replies (custom, share_contact, send_catalog, request_location): skipped when the pair (device, customer) is in cooldown. The cooldown is ONE timer per device+customer shared by ALL rules and all reply types, set to the returned `cooldown` seconds (0 if null) when a reply is sent; it lives only in process memory (lost on restart). A welcome/away rule returns its resend window (for example 86400) as `cooldown`, so after a welcome greeting every non-flow keyword reply to that customer is muted for that window (QUIRK).
  5. Custom reply: cooldown is armed BEFORE the delay, then Node waits `reply_delay` seconds (clamped 0..300) and sends. Text is personalised by replacing `{{name}}` (WhatsApp push name), `{{first_name}}`, `{{phone}}` with case- and space-tolerant matching; media descriptors are parsed (type image/video/document and a `url` required; caption un-wrapped if double-encoded and personalised; documents send the filename) else plain text.
  6. After a text send, Node mirrors the outbound into the team inbox (`direction out`, wa message id for dedup) because Baileys does not reliably re-emit its own sends; media replies are not mirrored here.
  7. share_contact builds a vCard 3.0 with `waid`; send_catalog sends the text "Here's our catalog: https://wa.me/c/<id>"; request_location sends `requestLocationMessage` with the fixed body "Please share your location".
  8. Group, newsletter and broadcast JIDs are never mirrored.
- **Async & events:** Timers in Node; outbound mirror HTTP call.
- **External systems:** WhatsApp Web (Baileys).
- **Settings:** Node `.env` `NODE_WEBHOOK_TOKEN`, app domain.
- **Acceptance criteria:**
  - Given cooldown 60 and two "price" messages 10 s apart from one customer, then one reply is sent.
  - Given a flow keyword typed during the cooldown, then the flow still starts.
  - Given reply_delay 5, then the send occurs about 5 s after the lookup response.
  - Given a welcome fired 5 minutes ago with a 24 h window, when the customer sends "price" (a non-flow keyword), then no reply is sent (documented quirk to remove in the port).
- **Source refs:** `node/classes/BaileysClientManager.js` (inbound handler, isInCooldown, setCooldown, checkKeywordReply, handleCustomAutoReply, sendMediaReply, mirrorOwnAutoReply), `node/controllers/providerFlowController.js`.
- **Port notes:** NODE/WADEV domain owns the adapter; this domain should only emit `{ruleId, action}`; cooldown moves to Redis keyed per rule and contact (WD-AR-019).

### WD-AR-039 — Dispatcher path for WABA, Twilio and channel bridges

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-AR-035, WD-AR-031
- **Summary:** Every non-Baileys inbound is handled by `KeywordReplyDispatcher::maybeDispatch(conversation, text, contactId, selfNumber, igTrigger)`. It applies the same responder passes and keyword matching as the Baileys lookup but with different scoping, no translation, no fuzzy fallback, no default route and no rule-cooldown enforcement.
- **Actors & access:** Internal; invoked by the inbound webhook handlers (below).
- **UX & screens:** None. Sent replies show in the team inbox as outbound bubbles with `meta.source = auto_reply` and appear in Message History with an "Auto-reply" type.
- **Endpoints:** No route of its own. Call sites: WABA/Twilio `WaWebhookController` (after routing rules and the Node provider-flow bridge; skipped when a flow consumed the message; the AI agent step follows), Instagram `InstaflowIngestService` (after the IG flow handoff, passes the IG trigger), and, only when the conversation has NO assigned AI agent (`assignee_agent_id` empty; otherwise the AI agent answers instead): Facebook, TikTok, Telegram, LINE, WeChat, Viber, SMS, and Email (MailTrixy) ingest.
- **Data:** Reads `keyword_replies`, contents, `conversations`, `contacts`, `devices`, `workspaces`; writes `inbox_messages` (the outbound bubble), `keyword_reply_logs`, `keyword_replies.trigger_count/last_triggered_at`, `conversations.routing_meta`.
- **Rules & edge cases:** Order and behavior:
  1. Empty text returns nothing (except the two Instagram no-keyword triggers). No workspace on the conversation returns nothing.
  2. Meta Business Agent coexistence: if the workspace's `suppressesOurAutoReply()` (Meta agent enabled with responder mode meta_agent_only or meta_agent_then_handoff), skip everything.
  3. Provider scope = the conversation's `provider` else the workspace default engine. Rules with NULL/empty provider always qualify.
  4. Anti-loop: if the contact id's digits equal the sender's own number digits (from `selfNumber` or the linked device), do nothing (protects from echoes of the operator's own messages).
  5. Flow-builder inbound conditions (`onInboundMessage`) run first, independent of rules.
  6. Sender scope for responder passes: rules with NULL `device_id`, OR equal to the conversation's `device_id`, OR (for mirror channels with no conversation `device_id`) the row id embedded in `conversations.raw_jid` as `<channel>:<rowId>:<peer>` with the SAME provider.
  7. Passes in order: welcome, away (if workspace away), out-of-hours (WD-AR-035 gates). For welcome, the FIRST welcome rule that passes gates ends processing even when building its reply fails (an empty-reply welcome blocks away, out-of-hours and keyword replies, QUIRK). For away and out-of-hours a failed build moves on to the next rule.
  8. `AutoReplyGuard::canAutoReply` (always true, WD-AR-041).
  9. Keyword candidates: workspace, status true, provider match; IG trigger scoping (WD-AR-028); then the SQL candidate filter (skipped for the two no-keyword IG triggers); first rule passing `matchesNeedle` (no-keyword IG triggers take the first candidate). Differences from Baileys (QUIRKS): no `device_id`/sender scoping (a rule bound to number A fires for messages on number B of the same workspace and provider), no exclusion of welcome/away/out-of-hours rows (a welcome rule whose name matches a customer's word can fire through this path bypassing its gates), no catch-all support (catch-all rows are removed by the candidate filter, so wizard-made default routes never fire here), no translation, no typo-fuzzy fallback.
  10. Per-rule cooldown check reads `keyword_reply_logs` filtering `contact_phone` equal to plain digits, but that column is encrypted with a random IV, so it never matches: the rule cooldown is NOT enforced on this path (QUIRK). The `HARD_FLOOR_SECONDS = 30` constant is declared but never used, so a repeated keyword replies every time.
  11. Keyword-rule gates that only apply if the columns are set (not settable in the wizard for keyword rules): excluded recipients, agent-override, working hours (outside action send = ship the outside-hours message, none = silent).
  12. Then reply building (WD-AR-040) and recording: log row (`contact_phone` = digits, `matched_text` = inbound body), counters, `AutoReplyGuard::markReplied`.
  13. Contact id digits are used as the "phone" even for non-phone identities (Telegram user id, Facebook PSID, IG conversation id, email address digits); flow enrolment may create a placeholder contact with `mobile` set to those digits (QUIRK).
  14. Echo of double evaluation on WABA/Twilio: see WD-AR-034 rule 10.
- **Async & events:** Runs inline in the webhook request; a delayed reply is deferred until after the response (`app()->terminating`) and sleeps up to 30 s inside the PHP worker (WD-AR-040).
- **External systems:** Provider send APIs via `InboxDispatcher` (Meta Cloud, Twilio Content API, channel APIs).
- **Settings:** Workspace `meta_agent_enabled` and `ai_responder_mode`.
- **Acceptance criteria:**
  - Given a keyword rule and a WABA inbound "price", then a reply is sent via the WABA sender and an outbound bubble with `meta.source=auto_reply` exists.
  - Given the operator's own number appears as the sender, then nothing is sent.
  - Given a Telegram conversation with an assigned AI agent, then the keyword rules are not evaluated.
  - Given the Meta agent is fronting the workspace, then no auto-reply is sent.
  - Given a wizard-created "Any message" rule on WABA, then it does not fire (documented gap; the port should support it).
- **Source refs:** `app/Services/Inbox/KeywordReplyDispatcher.php`, `app/Http/Controllers/WaWebhookController.php`, `app/Services/Instaflow/InstaflowIngestService.php`, `app/Services/Facebook/FacebookIngestService.php`, `app/Services/Tiktok/TiktokIngestService.php`, `app/Http/Controllers/Telegram/TelegramWebhookController.php`, `app/Http/Controllers/Line/LineWebhookController.php`, `app/Http/Controllers/WeChat/WeChatWebhookController.php`, `app/Http/Controllers/Viber/ViberWebhookController.php`, `app/Http/Controllers/Sms/SmsWebhookController.php`, `app/Services/Mailtrixy/MailtrixyIngestService.php`, `app/Models/Workspace.php` (suppressesOurAutoReply).
- **Port notes:** One resolver for all channels (WD-AR-032 tiers) called by an inbound-pipeline worker after routing and flow steps; channel adapters supply `{channelAccountId, contactExternalId, text, eventKind}`. Make it idempotent per inbound message id (dedupe key) so webhook retries do not double-reply. Replace `terminating()` sleeps with delayed BullMQ jobs.

### WD-AR-040 — Dispatcher reply builders: all reply types, delay, flow enrolment

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-039
- **Summary:** How the dispatcher path turns a chosen rule into an outbound message for every engine, so flow, contact, catalog, location, media and template rules are no longer silent on WABA/Twilio/channels.
- **Actors & access:** Internal.
- **UX & screens:** Outbound bubble in the team inbox; `meta` carries `auto_reply_id`, `source=auto_reply` and for responders `ar_kind` (trigger type), `welcome` and `outside_hours` flags.
- **Endpoints:** None.
- **Data:** Creates an `inbox_messages` row: conversation, user (conversation owner), `to_number` (contact digits), `direction=out`, `status=pending` then `sent` or `failed`, `body`, `media_path`, `media_type`, `meta`, `wa_message_id` from the provider result.
- **Rules & edge cases:**
  1. Placeholders (`substitute`): workspace attributes first, then exact tokens `{{name}}` (contact name, else "there"), `{{first_name}}` (first name, else first word of the name, else "there"), `{{mobile}}` and `{{phone}}` (contact digits), `{{email}}` (contact email or empty). No space tolerance: the wizard's demo text `{{ name }}` stays literal on this path (QUIRK) while Baileys fills it.
  2. Flow: enrol the contact (existing, or a minimal contact created on the fly) into the flow and record the fire; never for the outside-hours message. The flow is not checked for `is_active/is_published` here (QUIRK, differs from Baileys).
  3. share_contact: text card "name" + newline + "+number" (only if the contact is in this workspace); nothing shipped otherwise.
  4. send_catalog / request_location: the rule's own first text if present else a fixed English fallback sentence; nothing else is sent.
  5. Custom: first selected variant. Template type: message body = rendered text or the template's body; `meta.template_id/name/language` set so WABA sends a real template message and Twilio a registered ContentSid (only when the template belongs to the workspace). Image/video/document with a file: `media_path`/`media_type` and caption body (documents also carry the text as caption). Otherwise plain text only if non-empty; empty text and no media ships nothing (returns no rule).
  6. Delay: `timeout` seconds for non-flow replies, clamped 0..30; when > 0 and not running in console, the send is deferred to `app()->terminating` and sleeps in-process. Flow replies have no delay.
  7. Transport: `InboxDispatcher::send(message, platform)` where platform is the conversation platform (default W); success marks `sent` and stores the provider id, a provider failure or exception marks the message `failed` (the fire is still recorded in the log and counters). Only if saving the outbound row itself throws is the rule returned without recording a fire (logged).
  8. Media file paths are passed as stored (bare object path); legacy `uploads/...` paths are passed too.
  9. Responder replies (welcome/away/out-of-hours/outside message) use the same builder minus the share/catalog/location branches (they support only flow, template, media and text).
- **Async & events:** Deferred send via `terminating()` callback; `InboxMessage` observers may broadcast realtime events to the inbox (TIB1) and trigger outbound webhooks/CRM hooks.
- **External systems:** Meta Cloud API, Twilio, other channel APIs via `InboxDispatcher` (owned by CHAT/TIB1 and channel domains).
- **Settings:** None.
- **Acceptance criteria:**
  - Given a text rule "Hi {{first_name}}" and contact "Sara Ali", then the outbound body is "Hi Sara".
  - Given a template rule on a WABA workspace, then a template message is sent with the template's name and language.
  - Given a rule with timeout 10, then the send starts after the webhook response and is capped at 30 seconds of delay.
  - Given a media rule with a stored file, then the outbound message has media path/type and the caption.
  - Given a flow rule, then the contact is enrolled and no message is sent by this service.
- **Source refs:** `app/Services/Inbox/KeywordReplyDispatcher.php` (maybeDispatch, shipRuleReply, shipInbox, substitute, findOrMakeContact, recordFire), `app/Services/InboxDispatcher.php`.
- **Port notes:** Use the same `OutboundMessageSpec` as WD-AR-037; queue the send as a BullMQ job with `delay` and an idempotency key; write the audit/outbox event in the same transaction as the outbound message row.

### WD-AR-041 — Conversation-level auto-reply guard

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AR-039
- **Summary:** A service intended as a workspace-wide anti-flood gate for auto-replies. In v1.7.0 it is deliberately a no-op: `canAutoReply` always returns true; `markReplied` only stamps the last auto-reply time.
- **Actors & access:** Internal (dispatcher and routing engine auto_reply action).
- **UX & screens:** None here (the routing UI in TIB2 still shows cooldown/spam settings that do nothing).
- **Endpoints:** None.
- **Data:** Writes `conversations.routing_meta.last_auto_reply_at` (ISO timestamp) via `markReplied`.
- **Rules & edge cases:**
  1. Removed on request: the old hard-coded 12-hour per-contact cooldown and flood detector overrode each rule's own cooldown and swallowed repeated messages.
  2. Callers: `KeywordReplyDispatcher` (calls `canAutoReply` before keyword matching and `markReplied` after a fire) and `RoutingEngine`'s auto_reply action (TIB2).
  3. The timestamp is informational only.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given any conversation, when `canAutoReply` is asked, then it is true.
  - Given a fire, then `routing_meta.last_auto_reply_at` is updated.
- **Source refs:** `app/Services/Inbox/AutoReplyGuard.php`, `app/Services/Inbox/RoutingEngine.php`, `app/Services/Inbox/KeywordReplyDispatcher.php`.
- **Port notes:** Implement a real per-rule, per-contact throttle in Redis (WD-AR-019) and drop this class; keep an optional per-conversation flood cap if product wants it.

### WD-AR-042 — Flow-managed keyword rules (flow trigger sync)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AR-032
- **Summary:** A flow's keyword Trigger node is mirrored into a hidden-in-plain-sight `keyword_replies` row so the normal inbound matcher can start the flow. Operators see these rows in the Auto Reply list.
- **Actors & access:** Automatic on every flow save/publish/pause/delete (FLB owns the trigger UI); visible to auto-reply admins.
- **UX & screens:** In the Auto Reply list the rule appears as `Flow / <flow name>` with the flow's trigger keywords; it can be toggled, edited or deleted here but any later flow save regenerates it.
- **Endpoints:** None in this domain (`Flow` model `saved` and `deleted` hooks).
- **Data:** `keyword_replies` row: `user_id` = flow owner, `workspace_id`, `device_id` = the trigger node's device (nullable), `provider` = the flow's provider (else workspace default), `keyword` = the trigger keywords string (empty for catch-all), `matching_method` = contains (exact for catch-all), `is_catch_all`, `fuzzy_similarity` 80, `reply_type='flow'`, `flow_id`, `is_flow_trigger=1`, `message_type='text'`, `status` = flow `is_published` AND `is_active`. Index `(flow_id, is_flow_trigger)`. Related: `flows.trigger_keywords` (string 1000).
- **Rules & edge cases:**
  1. Idempotent: every save force-deletes the flow's previous managed rows and recreates from current state; deleting the flow force-deletes them (and its Instagram automations).
  2. Only for `trigger_kind = keyword`, and only for WhatsApp-family flows: Instagram flows get a managed `instagram_automations` row instead; Facebook, TikTok, Telegram and Email flows create no row (the ingest service resolves them directly from `flows`).
  3. Catch-all spellings `*`, `.*`, `.+`, `any` become `is_catch_all` rules with an empty keyword.
  4. Keywords longer than 255 characters (non catch-all) raise an error that surfaces to the operator on save ("Trigger keyword is too long...").
  5. A NULL `device_id` (no device on the Trigger node) produces a workspace-wide rule.
  6. Because the matcher is provider-agnostic and identified by device id, these rules follow the Baileys lookup semantics (WD-AR-032) and, through the Node provider-flow bridge, WABA/Twilio flow starts.
  7. On the dispatcher path (WABA/Twilio/channels) a flow-managed `contains` rule can ALSO match in the dispatcher and enrol the contact a second time (the email path avoids this by not creating a row).
- **Async & events:** Model events; log lines `[FLOW-KW-SYNC]`.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a published, active flow with trigger keywords "book, reserve", when saved, then an active `is_flow_trigger` rule with `contains` and those keywords exists.
  - Given the flow is paused, then the rule exists with `status=false`.
  - Given the flow is deleted, then the rule is gone.
  - Given trigger keyword "any", then a catch-all rule with empty keyword exists.
- **Source refs:** `app/Models/Flow.php` (syncKeywordTriggerReply, syncInstagramTriggerAutomation, booted), `app/Http/Controllers/FlowsController.php`, `database/migrations/2026_06_19_000400_flow_keyword_trigger_sync.php`.
- **Port notes:** In the new design the flow trigger should be a first-class row in the flow module resolved by the same resolver tier system, not a synthetic rule in another table; if kept, mark the rows read-only in the rule list.

### WD-AR-043 — Per-rule keyword analytics page

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-AR-036
- **Summary:** A detail page for one rule showing fires over the last 30 days, hour-of-day heatmap, top senders, matched-text breakdown, a lookup funnel and server-side latency.
- **Actors & access:** Workspace admin/owner; no plan gate (paywall overlay only).
- **UX & screens:** `resources/views/user/auto-reply/keyword.blade.php` + `user-auto-reply-keyword.js` (ApexCharts).
  - Header card: two-letter tile, keyword, chips (match sub-label, type pill, device phone, Active/Paused), "Pause rule/Resume rule" and "Edit rule" buttons.
  - KPI strip (5): Triggered (all-time `trigger_count`), Last fired (date and relative), Match method (method and similarity), Cooldown (seconds or "no limit"), Reply latency (avg ms and p95; "target 1.5 s").
  - Charts: 30-day area chart of fires per day (zero-filled), donut + list "Variant breakdown - Which spelling fires" (top 5 `matched_variant` values), 24-bucket hour heatmap (last 30 days), conversion funnel bars, "Recent triggers" table (last 8 fires: time, masked sender, message truncated to 60 chars, variant, latency shown as a dash, status shown as "Sent"), "Top users" (top 5 senders with counts) and "unique senders" count, "Health checks" tiles (match rate >= 60% healthy, latency <= 1.5 s, 7-day/30-day fires), and a static "Reply preview" card with hard-coded demo text.
  - Dead controls: the date-range select (7/30/90 days/year), the "Export CSV" button, and the chart mode buttons (Triggers, Match rate, Latency) do nothing.
  - Empty states per widget; the whole page renders with dashes when no rule exists.
- **Endpoints:**

| Method uri             | Route name              | Action                      | Middleware                      | Request                                | Response |
| ---------------------- | ----------------------- | --------------------------- | ------------------------------- | -------------------------------------- | -------- |
| GET auto-reply/keyword | user.auto-reply.keyword | AutoReplyController@keyword | web, auth, workspace.role:admin | `id` (preferred) or `k` (keyword text) | HTML     |

- **Data:** Reads `keyword_reply_logs` (rule, last 30 days, newest first, max 2000 rows) and `auto_reply_lookups` (by the rule's `device_id`, last 30 days, columns matched id and latency).
- **Rules & edge cases:**
  1. Rule resolution: `id` in the workspace; else `k` = case-insensitive substring match on keyword, first row (the list links use `k`, so with duplicate or overlapping keywords the page may show another rule than the one clicked, QUIRK); else the workspace's most-triggered rule; none = empty page. Wrong or foreign ids fall through silently.
  2. Aggregates are computed in PHP over at most 2000 log rows, so high-volume rules are under-reported in all 30-day widgets.
  3. Top users group by the stored `contact_phone` (a JID on Baileys, digits on the dispatcher path); display mask shows the first 4 characters, four bullets, and the last 3 characters of that string, so JIDs end in "net" (QUIRK). Hour buckets use the app timezone of `fired_at`.
  4. Funnel: Incoming = all lookup rows for the rule's device in 30 days; Matched any = rows with a matched rule; Matched this rule = rows matching this id; "Reply sent" = the same number as Matched this rule (no delivery data). Because only the Baileys lookup writes `auto_reply_lookups`, the funnel and latency are empty for WABA/Twilio/channel rules.
  5. Latency: average of `latency_ms` over lookups matched to this rule, and p95 by index floor(0.95 x n) of the sorted values.
  6. Variant breakdown groups by `matched_variant` (which holds the truncated inbound text, not the matched keyword, QUIRK).
  7. The Pause/Resume button calls the toggle endpoint and reloads.
  8. A `detected_language` breakdown is not shown (column is never populated).
- **Async & events:** None.
- **External systems:** ApexCharts (client).
- **Settings:** None.
- **Acceptance criteria:**
  - Given a rule with 10 fires this week, when opening `?id=<id>`, then fires7d shows 10 and the daily chart has 30 points.
  - Given a rule with no logs, then charts show "No fires in the last 30 days." and tables show empty states.
  - Given `?k=price` matching several rules, then the first match by database order is shown.
  - Given an agent role, then the page is not reachable.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php` (keyword), `resources/views/user/auto-reply/keyword.blade.php`, `resources/js/charts/user-auto-reply-keyword.js`, `app/Models/KeywordReplyLog.php`, `app/Models/AutoReplyLookup.php`, `Documentation/pages/messaging/auto-reply.html`.
- **Port notes:** Do the aggregations in SQL (`date_trunc`, `extract(hour)`) over indexed `(rule_id, fired_at)`; make range selectable and implement CSV export; record the matched token and outcome (sent, blocked, failed) per fire so the funnel is honest; write logs for every engine.

### WD-AR-044 — Keyword pre-translation service and backfill command

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-AR-033
- **Summary:** A service and an artisan command that pre-translate each rule's keyword and text replies into a workspace's target languages and store the results on the rows. The UI no longer calls it (save is instant); only the command does.
- **Actors & access:** Platform operators via CLI. Shared with I18N (this domain owns the columns; I18N owns the engine).
- **UX & screens:** None. CLI: `php artisan auto-reply:translate-existing` with `--workspace=<id>` (one workspace) and `--force` (re-translate rows that already have translations). Prints a progress bar and "Done. N translated, M failed."; exit code failure if any row failed; "Nothing to backfill" when there is nothing to do.
- **Endpoints:** None.
- **Data:** Writes `keyword_replies.keyword_translations` (map including the canonical language key) and `canonical_language`; writes `keyword_reply_contents.content_translations` for `content_type = text` non-empty variants. Targets = `workspaces.auto_translate_languages` if a non-empty array, else a built-in list of about 100 language codes (Indic, Iranian, Dravidian, East/Southeast Asian, Semitic, Turkic, Romance, Germanic, Slavic, other European, African, Caucasus, misc). Source language = the rule's canonical language, else workspace default language, else en.
- **Rules & edge cases:**
  1. Without `--force` only rows whose `keyword_translations` is NULL are processed; chunked by 50 by id.
  2. Each row triggers one keyword fan-out plus one fan-out per text variant; provider calls are sequential in practice, so a full run is slow and consumes provider quota.
  3. The service's own docblock and the controller docblock claim it is called on store/update; it is not (QUIRK).
  4. `pickContent` and `targetsFor` in the same class ARE used at runtime (WD-AR-033).
  5. Failures per row are printed and counted, not thrown.
  6. Not scheduled; never runs automatically.
- **Async & events:** CLI only.
- **External systems:** Translation providers (I18N).
- **Settings:** `workspaces.auto_translate_languages`, `workspaces.default_language`.
- **Acceptance criteria:**
  - Given a rule with keyword "hello" and NULL translations, when the command runs, then `keyword_translations` contains the canonical key and translated values, and text variants get `content_translations`.
  - Given `--workspace=5`, then only that workspace's rules are processed.
  - Given all rows already translated and no `--force`, then the command prints that there is nothing to backfill and exits successfully.
- **Source refs:** `app/Console/Commands/BackfillKeywordTranslations.php`, `app/Services/KeywordTranslationManager.php`, `database/migrations/2026_05_19_010000_multilingual_keyword_replies.php`.
- **Port notes:** Prefer an async per-rule job triggered on rule change (with a workspace-level "auto-translate" toggle) over a manual command; store translations in a child table keyed by (rule, language). Consider dropping pre-translation and keeping lazy runtime translation only.

## Data model

Row volumes on a real install: `keyword_replies` tens to low hundreds per workspace (one row per sender per rule); `keyword_reply_contents` 1-2 rows per rule; `keyword_reply_logs` one row per fire (grows with traffic, never pruned); `auto_reply_lookups` one row per Baileys inbound text (matched or not, never pruned, the highest-volume table of the domain). The seeded reference database has 0 rows in all four.

### keyword_replies (model `KeywordReply`, soft deletes)

Purpose: one auto-reply rule per sender; also holds welcome/away/out-of-hours/default-route rules and flow-managed trigger rows. Read by: list, edit, analytics, both runtime paths. Written by: store, update, toggle, bulk, import, destroy, lookup (counters), dispatcher (counters), flow sync, backfill command. Created by migrations 2026_05_06_160000 and later.

| Column                             | Type / default                 | Behavior                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                 | bigint PK                      |                                                                                                                                                                                                                                   |
| user_id                            | bigint, NOT NULL               | Creator (or flow owner for managed rows); indexed. Legacy scope for NULL-workspace rows.                                                                                                                                          |
| workspace_id                       | bigint, NOT NULL               | Tenant key; indexed. Composite indexes `(workspace_id, status)`, `(workspace_id, keyword)`, `(workspace_id, provider)`, `kwr_catchall_idx (workspace_id, device_id, is_catch_all, status)`.                                       |
| provider                           | varchar(16), default `baileys` | Engine/channel of the bound sender: baileys, waba, twilio, instagram, facebook, telegram, line, wechat, viber, sms, email (NULL/empty in legacy rows = any). Auto-stamped from the workspace default engine on create when empty. |
| device_id                          | bigint NULL                    | Sender row id in a table selected by `provider` (devices, wa_provider_configs, Instaflow account, channel rows). NULL = workspace-wide. No FK.                                                                                    |
| keyword                            | varchar(255), NOT NULL         | Comma-separated tokens (keyword rules), the regex pattern (method regex), or a display label (welcome, away, catch-all; empty for flow-managed catch-all). Plain text (SQL match key).                                            |
| keyword_translations               | JSON NULL                      | `{lang: translated keyword}`; only filled by the backfill command.                                                                                                                                                                |
| canonical_language                 | varchar(8), default en         | Language of `keyword` and reply text.                                                                                                                                                                                             |
| matching_method                    | varchar(12), default exact     | exact, fuzzy, contains, regex.                                                                                                                                                                                                    |
| is_catch_all                       | tinyint(1), default 0          | Default route flag.                                                                                                                                                                                                               |
| trigger_type                       | varchar(16), default keyword   | keyword, welcome, out_of_hours, away. Indexed.                                                                                                                                                                                    |
| ig_trigger                         | varchar(24) NULL               | dm_keyword, comment_to_dm, story_reply, story_mention, mention. Indexed.                                                                                                                                                          |
| fuzzy_similarity                   | tinyint unsigned, default 80   | 0-100.                                                                                                                                                                                                                            |
| reply_type                         | varchar(32), NOT NULL          | custom, flow, share_contact, send_catalog, request_location.                                                                                                                                                                      |
| flow_id                            | bigint NULL                    | Target flow. Index with `is_flow_trigger`.                                                                                                                                                                                        |
| is_flow_trigger                    | tinyint(1), default 0          | Managed by the flow sync.                                                                                                                                                                                                         |
| target_contact_id                  | bigint NULL                    | For share_contact.                                                                                                                                                                                                                |
| target_catalog_id                  | bigint NULL                    | For send_catalog (`wa_catalogs.id`).                                                                                                                                                                                              |
| cooldown                           | int unsigned NULL              | Seconds. Per-customer cooldown for Node; for responders the resend window.                                                                                                                                                        |
| resend_unit                        | varchar(12) NULL               | Display unit only (minutes/hours/days).                                                                                                                                                                                           |
| stop_on_agent_reply                | tinyint(1), default 0          | Agent-override pause.                                                                                                                                                                                                             |
| resume_after                       | int unsigned NULL              | Seconds.                                                                                                                                                                                                                          |
| resume_unit                        | varchar(12) NULL               | Display unit.                                                                                                                                                                                                                     |
| timeout                            | int unsigned NULL              | Reply delay (custom) or flow session timeout (flow), seconds.                                                                                                                                                                     |
| working_hours                      | JSON NULL                      | `{enabled, days[], from, to, timezone, outside_action}`.                                                                                                                                                                          |
| excluded_numbers                   | JSON NULL                      | Array of digit strings.                                                                                                                                                                                                           |
| excluded_group_ids                 | JSON NULL                      | Array of contact group ids.                                                                                                                                                                                                       |
| message_type                       | varchar(12), default text      | Denormalised type of the first variant for list badges (text, image, video, document, template); not updated on edit.                                                                                                             |
| status                             | tinyint(1), default 1          | Active flag; indexed.                                                                                                                                                                                                             |
| trigger_count                      | bigint unsigned, default 0     | Lifetime fires; indexed.                                                                                                                                                                                                          |
| last_triggered_at                  | timestamp NULL                 |                                                                                                                                                                                                                                   |
| priority                           | int, default 0                 | Order among responders; indexed.                                                                                                                                                                                                  |
| deleted_at, created_at, updated_at | timestamps                     | Soft delete.                                                                                                                                                                                                                      |

Casts: booleans, `keyword_translations`/`working_hours`/`excluded_*` as arrays. Constants: MATCHING_METHODS, REPLY_TYPES, MESSAGE_TYPES, TRIGGER_TYPES, IG_TRIGGERS, IG_TRIGGERS_NO_KEYWORD (story_mention, mention). No unique constraint. Scopes: forWorkspace (returns everything when the id is falsy), forListing (WD-AR-001), welcomeFor/awayFor/outOfHoursFor, matchKeyword.

### keyword_reply_contents (model `KeywordReplyContent`)

Purpose: reply variants per rule. Written by store, update, import, syncContents/syncOutsideContents, fan-out replicate, backfill (translations). No soft delete, no workspace_id (tenant is inherited through the rule).

| Column                   | Type / default               | Behavior                                                                               |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------- |
| id, keyword_reply_id     | bigint                       | FK by convention, indexed; no DB constraint.                                           |
| content_type             | varchar(12), default text    | text, image, video, document, template.                                                |
| variant_role             | varchar(16), default primary | primary or outside_hours; indexed.                                                     |
| content                  | text NULL, encrypted by cast | Body or caption. Laravel `encrypted` (AES with app key).                               |
| content_translations     | JSON NULL                    | `{lang: text}` (text variants only).                                                   |
| file_path                | varchar(500) NULL            | Bare object path on the media disk (or legacy `uploads/...`).                          |
| original_name, mime_type | varchar NULL                 |                                                                                        |
| file_size                | int unsigned NULL            | Bytes.                                                                                 |
| template_id              | bigint NULL                  | `wa_templates.id`.                                                                     |
| is_selected              | tinyint(1), default 1        | Only selected primary variants are candidates; outside variants are stored unselected. |
| sort_order               | int unsigned, default 0      | First selected by sort_order is sent.                                                  |
| created_at, updated_at   |                              |                                                                                        |

### keyword_reply_logs (model `KeywordReplyLog`)

Purpose: one row per fire for analytics. Written by lookup and dispatcher; read by the analytics page, admin translation usage (I18N, cache ratio) and nothing else. Indexes `(keyword_reply_id, fired_at)`, `fired_at`. No workspace_id.

| Column                                                | Behavior                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| keyword_reply_id                                      | The rule (not FK-enforced).                                                       |
| content_id                                            | Variant id that fired (Baileys path only).                                        |
| contact_phone (text, encrypted)                       | Baileys: raw JID `digits@s.whatsapp.net`; dispatcher: digits only.                |
| matched_text (text NULL, encrypted)                   | Raw inbound text (dispatcher stores the trimmed body; empty for responder fires). |
| matched_variant (varchar 64)                          | First 64 chars of the lower-cased inbound (Baileys only).                         |
| detected_language (varchar 8)                         | Never persisted (not fillable).                                                   |
| fired_at (timestamp NOT NULL), created_at, updated_at |                                                                                   |

### auto_reply_lookups (model `AutoReplyLookup`, no updated_at)

Purpose: audit of every Baileys lookup for the funnel, latency KPI and the /more match-rate. Indexes `(device_id, created_at)`, `(matched_keyword_reply_id, created_at)`, `created_at`, `workspace_id`; FK `workspace_id` to `workspaces` ON DELETE SET NULL.

| Column                                      | Behavior                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| device_id                                   | Resolved device (or stand-in config id); NULL on early exits.                                                 |
| matched_keyword_reply_id                    | Matched rule, NULL if none/blocked (set on billing-block).                                                    |
| contact_phone, query_text (text, encrypted) | The `mobile` value and the raw keyword.                                                                       |
| latency_ms (int unsigned NULL)              | Server-side lookup time.                                                                                      |
| created_at (timestamp, default now)         |                                                                                                               |
| workspace_id (bigint NULL)                  | Added by the 2026_05_19 legacy backfill; never written by the model (not fillable), so NULL for all new rows. |

### Columns owned elsewhere and used here

`workspaces.inbox_away` (WSP), `workspaces.auto_translate_languages` and `default_language` (WSP/I18N), `workspaces.plan_overrides`, `packages.access_keyword_replies` / `autoreply_limit` / `autoreply` (PLAN), `conversations.routing_meta` JSON (`ar_fires`, `last_auto_reply_at`) (TIB1/TIB2), `flows.trigger_keywords`, `flows.is_active`, `flows.is_published` (FLB), `contacts.contact_group` (CON), `wa_templates`, `wa_catalogs`, `devices`, `wa_provider_configs`, `inbox_messages`.

## Cross-domain contracts

Consumes:

- **WADEV / WABA / NODE:** the sender inventory (`WorkspaceEngine::senders`, `senderForKey`, `enginesFor`, `for`), device and provider-config rows, the Node bridge (`X-Node-Token`, `/api/keyword-replies` caller, `/api/flow/provider-inbound`, `/api/inbound-message` mirror), WhatsApp send methods via `InboxDispatcher`.
- **FLB / FLR:** flow definitions and liveness (`is_active`, `is_published`), `FlowEnrollmentService::enroll` and `onInboundMessage` (away/out-of-hours flow triggers), the flow save hook that calls `syncKeywordTriggerReply`.
- **TIB1 / TIB2:** `Conversation`, `InboxMessage` (in/out counts, agent reply detection, outbound bubble creation, `routing_meta`), `RoutingEngine` (auto_reply action and `AutoReplyGuard`), business hours (separate from rule hours).
- **CON:** contacts (decrypt-scan lookup by digits, `contact_group`, share-contact target), attributes (`AttributeResolver`).
- **TPL / CAT:** approved templates (and their `variable_map`), `wa_catalogs`.
- **I18N:** `Translator` (dictionary, cache, provider chain), `LanguageDetector`, provider admin, workspace language settings, the shared `KeywordTranslationManager` and the `auto-reply:translate-existing` command.
- **PLAN / WSP / RBAC:** `PlanLimitGuard`, package flags, `Workspace::effectiveLimit`, `workspace.role:admin` middleware, `workspaces.inbox_away`.
- **WALLET:** `OverflowBilling::consumeOne` (no-op under delivery-time billing) and the delivery-time billing that actually charges.
- **STORE:** `StorefrontOrderParser::parse` called on every Baileys lookup.
- **Channels (IG, FB, TG, LINE, WECH, VIB, SMS, TT, MAIL):** each ingest service calls `KeywordReplyDispatcher::maybeDispatch`; IG passes `ig_trigger`.
- **AIAG:** conversations with an assigned AI agent skip the dispatcher on non-WhatsApp channels; AI agent runs after the dispatcher on WABA/Twilio.
- **SET:** media disk/cloud storage for uploads (`media_disk`, `media_url`), `SecureUpload`.

Exposes:

- **API:** `GET/POST/PUT/DELETE /api/v1/auto-replies` (Api/V1 controller wraps the Api/App controller; fields keyword, matching_method exact/fuzzy/contains, fuzzy_similarity, device_id, reply_type custom/flow, flow_id, status, replies[] (text only)). Reads/writes `keyword_replies` and `keyword_reply_contents` exactly as this domain defines. Owned by API.
- **MOB:** `/api/app/autoreplies` (index/show/store/update/destroy and `getflows`), sender label helper, multi-message variants via `text_messages[]`/`checked_texts[]`, media upload. Owned by MOB.
- **ASHELL (/more dashboard):** `KeywordReply::forListing` counts (rule count, active count, new this week) and `auto_reply_lookups` 30-day matched ratio for the "% match" chip (the ratio filters on `auto_reply_lookups.workspace_id`, which this domain never writes, so it is null for new traffic).
- **I18N:** admin translation usage reads `keyword_reply_logs` for the cache-ratio estimate.
- **FLB:** managed keyword rows (`is_flow_trigger`), Instagram comment-to-DM rule list, flow-analytics queries by flow id.
- **WSP:** `workspaces:wipe-expired` deletes `keyword_replies` for expired workspaces (contents/logs/lookups are not in its list, so they become orphans).
- **Message History (CHAT):** outbound bubbles created by the dispatcher carry `meta.source = auto_reply`, shown as the "Auto-reply" type.
- **TIB2:** `AutoReplyGuard` class (no-op gate + `last_auto_reply_at`).

## Open questions & quirks

Docs versus code:

1. `Documentation/pages/messaging/auto-reply.html` describes only the classic keyword flow. It does not mention Welcome/Away/Out-of-hours, the Any-message default route, regex, working hours, resend/agent-override, exclusions, Instagram triggers or the Away switch (all built in 2026-07/08).
2. Docs say editing a rule that applies to several numbers "changes only that one number's copy"; code additionally fans out to any extra ticked senders as sibling rows when saving an edit (WD-AR-012).
3. Docs say the cooldown is the minimum time before "the same rule fires again for the same contact". Baileys: one in-memory timer per device+customer across all rules (WD-AR-038). WABA/Twilio/channels: not enforced (WD-AR-039).
4. Docs say a rule "charges one message credit to the wallet". Under the default delivery-time billing setting the send-time call is a no-op (WD-AR-036).
5. Docs say "the Auto Reply page only shows rules for the workspace's active engine"; code shows all enabled engines plus some channels (WD-AR-001 rule 1).
6. The analytics page shows a date-range select, an Export CSV button and chart-mode tabs that have no behavior, and a static "Reply preview" card with hard-coded text and "53 chars".
7. `AutoReplyController` and `KeywordTranslationManager` docblocks say translation is done on store/update; it is not.

Dead or unused code: 8. `UserPagesController::autoReply`, `autoReplyCreate`, `autoReplyKeyword` return the views without data and have no routes (dead code). 9. Unused: `KeywordReply::scopeActive`, `HasEngineScope::scopeForCurrentEngine` for this model, `AutoReplyLookup::scopeMatched/scopeForRule`, `KeywordReplyLog::scopeRecent`, `KeywordReply::user()` relation, `KeywordReplyDispatcher::HARD_FLOOR_SECONDS`. 10. The `Save draft` button and the composer toolbar buttons (bold, italic, strike, variable, emoji) and the document "Filename shown to recipient" field do nothing. 11. The `out_of_hours` trigger has no UI (WD-AR-017); the `excluded_group_ids` field has no UI (WD-AR-022).

Data and correctness bugs to fix rather than port: 12. `keyword_reply_logs.detected_language` is never saved (missing from fillable). `auto_reply_lookups.workspace_id` is never saved, which silently zeroes the /more "% match" chip for new traffic. 13. Lookup and analytics store the WhatsApp JID as `contact_phone`; the dispatcher stores digits; the analytics mask therefore shows JIDs ending in "net". 14. Keyword-rule cooldown is ineffective outside Baileys because it filters an encrypted column with a plain value (WD-AR-039 rule 10). A welcome/away resend window leaks into the Node cooldown and mutes all other non-flow replies for that customer (WD-AR-038 rule 4). 15. Dispatcher keyword matching ignores the sender binding, does not exclude responder rows, has no default route, no translation and no typo-fuzzy. Baileys keyword matching ignores `provider`, so channel-row ids can collide with device ids. 16. Live-translation stage returns the first SQL candidate without the confirming match, and every regex rule is a candidate (WD-AR-032 step 7). 17. `priority` is honoured only for welcome/away/out-of-hours. 18. Update path lacks ownership checks for flow, contact, catalog and template ids; `forWorkspace` returns all rows when the workspace id is empty; the lookup scans all active devices platform-wide when the owner config is unknown; import ignores `autoreply_limit` and provider stamping; the numeric cap is checked before fan-out. 19. Media edits drop the file unless re-uploaded and orphan the old blob; image and video caption fallback picks the text-tab demo greeting; document captions do not exist; UI size limits are not enforced. 20. Editing a keyword rule cannot rename it (the "Rule name" for keyword rules is the first keyword); regex patterns containing commas cannot be entered. 21. Index limits to 500 rules and computes everything in memory; rules with providers line, wechat, viber, sms, tiktok are invisible; SMS and TikTok cannot be created from the wizard although their webhooks dispatch. 22. Raw diagnostic logging in `lookup` dumps every active rule on the platform and full device numbers on each call (privacy and performance). 23. `auto_reply_lookups` and `keyword_reply_logs` are never pruned; the workspace wipe command does not clear contents/logs/lookups.

Needs live verification (later, with the parity skill): 24. WABA/Twilio double evaluation: the Node provider-flow bridge calls the Baileys lookup for typed messages; the lookup's responder passes stamp `ar_fires`, bump counters and write logs even though the bridge ignores non-flow replies, and the dispatcher then runs its own passes (WD-AR-034 rule 10). Expected effects: welcome/away greeting possibly suppressed and fires double-counted on WABA/Twilio. 25. Baileys inbound persistence is fire-and-forget and races with the lookup; `isFirstContact` tolerates 0 or 1 stored inbound, but a brand-new contact has no conversation yet so the welcome fire time cannot be stamped. 26. Which of the WhatsApp Business "away/greeting" behaviors should be native to the Cloud API path versus ours. 27. The encryption of `content` (and phone/text in logs) cannot be searched; confirm product wants to keep at-rest encryption for reply copy. 28. `GET api/v1/auto-replies` and `/api/app/autoreplies` (API and MOB domains) do not expose responder fields (trigger_type, working hours, priority) and pick text variants differently; the API/MOB writers should confirm their coverage against WD-AR-010/012.

Routes not claimed here (belong to other domains): `api/v1/auto-replies*` (API), `api/app/autoreplies*` and `api/app/getflows` (MOB). Files not claimed: `app/Http/Requests/Api/V1/AutoReply/*`, `app/Http/Resources/Api/V1/AutoReplyResource.php` (API); `node/classes/BaileysClientManager.js`, `node/controllers/providerFlowController.js` (NODE/WADEV, described in WD-AR-038); `config/plan_gates.php` (ASHELL/PLAN); `app/Support/SecureUpload.php` (CORE).

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET auto-reply",
    "POST auto-reply",
    "POST auto-reply/away-mode",
    "POST auto-reply/bulk",
    "GET auto-reply/create",
    "GET auto-reply/demo-csv",
    "POST auto-reply/import",
    "GET auto-reply/keyword",
    "PATCH auto-reply/{id}",
    "DELETE auto-reply/{id}",
    "POST auto-reply/{id}/toggle",
    "GET api/keyword-replies"
  ],
  "controllers": ["app/Http/Controllers/AutoReplyController.php"],
  "services": [
    "app/Services/Inbox/AutoReplyGuard.php",
    "app/Services/Inbox/AutoResponderEvaluator.php",
    "app/Services/Inbox/KeywordReplyDispatcher.php",
    "app/Services/KeywordTranslationManager.php"
  ],
  "models": ["AutoReplyLookup", "KeywordReply", "KeywordReplyContent", "KeywordReplyLog"],
  "tables": [
    "auto_reply_lookups",
    "keyword_replies",
    "keyword_reply_contents",
    "keyword_reply_logs"
  ],
  "views": [
    "resources/views/user/auto-reply/_grid.blade.php",
    "resources/views/user/auto-reply/_rows.blade.php",
    "resources/views/user/auto-reply/create.blade.php",
    "resources/views/user/auto-reply/index.blade.php",
    "resources/views/user/auto-reply/keyword.blade.php"
  ],
  "commands": ["auto-reply:translate-existing"],
  "permissions": [],
  "middleware": ["app/Http/Middleware/EnsureWorkspaceRole.php"],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/user-auto-reply-create.js",
    "resources/js/charts/user-auto-reply-index.js",
    "resources/js/charts/user-auto-reply-keyword.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": ["Documentation/pages/messaging/auto-reply.html"],
  "feature_map": {
    "WD-AR-001": ["GET auto-reply"],
    "WD-AR-002": ["GET auto-reply"],
    "WD-AR-003": ["POST auto-reply/away-mode"],
    "WD-AR-004": ["POST auto-reply/{id}/toggle"],
    "WD-AR-005": ["POST auto-reply/bulk"],
    "WD-AR-006": ["DELETE auto-reply/{id}"],
    "WD-AR-007": ["POST auto-reply/import"],
    "WD-AR-008": ["GET auto-reply/demo-csv"],
    "WD-AR-009": ["GET auto-reply/create"],
    "WD-AR-010": ["POST auto-reply"],
    "WD-AR-011": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-012": ["PATCH auto-reply/{id}"],
    "WD-AR-013": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-014": ["POST auto-reply", "PATCH auto-reply/{id}", "GET api/keyword-replies"],
    "WD-AR-015": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-016": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-017": ["POST auto-reply"],
    "WD-AR-018": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-019": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-020": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-021": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-022": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-023": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-024": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-025": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-026": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-027": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-028": ["POST auto-reply", "PATCH auto-reply/{id}"],
    "WD-AR-029": [
      "POST auto-reply",
      "PATCH auto-reply/{id}",
      "POST auto-reply/bulk",
      "POST auto-reply/import",
      "POST auto-reply/away-mode"
    ],
    "WD-AR-030": ["GET api/keyword-replies"],
    "WD-AR-031": ["GET api/keyword-replies"],
    "WD-AR-032": ["GET api/keyword-replies"],
    "WD-AR-033": ["GET api/keyword-replies"],
    "WD-AR-034": ["GET api/keyword-replies"],
    "WD-AR-035": ["GET api/keyword-replies"],
    "WD-AR-036": ["GET api/keyword-replies"],
    "WD-AR-037": ["GET api/keyword-replies"],
    "WD-AR-038": ["GET api/keyword-replies"],
    "WD-AR-039": [],
    "WD-AR-040": [],
    "WD-AR-041": [],
    "WD-AR-042": [],
    "WD-AR-043": ["GET auto-reply/keyword"],
    "WD-AR-044": []
  }
}
```
