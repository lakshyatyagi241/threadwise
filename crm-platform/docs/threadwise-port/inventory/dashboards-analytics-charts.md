---
domain: dashboards-analytics-charts
code: DASH
title: Dashboards, analytics, chart widgets, financial and health views
threadwise_version: '1.7.0'
sources_read: 58
---

# Dashboards, analytics, chart widgets, financial and health views

## Overview

This domain is the read-only "numbers" layer of Reference: five report surfaces plus the shared chart layer they draw with. Nothing here owns a table; every screen is a live aggregation over data owned by other domains, computed inside the controller on each page load (no caching, no rollup tables, no queue, no schedule). A rebuild therefore consists of (a) a metrics query layer with exactly the Reference definitions of "sent / delivered / read / failed / queued / reply", (b) five pages built on it, and (c) a small chart rendering convention.

Surfaces and audiences:

| Surface                                    | Route                                                                    | Audience                                                   | Gate                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Workspace dashboard ("Operator Dashboard") | `GET /dashboard`                                                         | Workspace owner / admin / manager (platform admins bypass) | workspace role >= manager                                                   |
| Workspace analytics                        | `GET /analytics`, `GET /analytics/export`                                | Same                                                       | role >= manager + plan flag `access_analytics` (soft gate, see TW-DASH-022) |
| Dashboard Quick-access tiles               | `POST /quick-access`                                                     | Any signed-in user                                         | auth only                                                                   |
| Admin overview                             | `GET /admin`                                                             | Platform admin                                             | `EnsureUserIsAdmin` + `IPAllowlist`                                         |
| Admin analytics                            | `GET /admin/analytics` (+ `?export=csv`)                                 | Platform admin                                             | same                                                                        |
| Admin financial                            | `GET /admin/financial`                                                   | Platform admin                                             | same                                                                        |
| System health                              | `GET /admin/health` (+ `?format=json`), `POST /admin/health/clear-queue` | Platform admin                                             | same                                                                        |
| Landing router                             | `GET /home`                                                              | any signed-in user                                         | auth                                                                        |

Main flows:

- Sign-in lands on `/home`, which is only a router: platform admins go to `/admin`, agents and viewers go to `/team-inbox`, everyone else goes to `/dashboard` (TW-DASH-001).
- The workspace dashboard is a one-screen rollup of the last N days for the current workspace: four KPI cards, an optional Instagram band, pinned shortcuts, an optional sales-pipeline strip, a message throughput chart, active broadcasts, connected numbers, top templates, live inbox preview, automation flows, an engagement funnel, an activity log, quick actions and an integrations panel. Its date range is a server round trip (`?range=`), so every card recomputes.
- Workspace analytics is the deeper single-window report (7d / 30d / 90d / custom) with trend badges against the immediately preceding window, more charts, a heatmap and a per-agent table, plus a server-side CSV.
- Admin overview / analytics / financial / health are platform-owner control-room pages. Overview and financial take a `?window=` picker and compare to the previous equal-length window; analytics takes `?days=`; health polls JSON every 20 seconds.

Plan tiers: only one plan gate is involved (`access_analytics` for `/analytics`), plus feature-conditional cards on the dashboard (`access_sales_pipeline` for the pipeline strip; a connected Instagram account for the Instagram band; the platform-allowed engine set for the device card). The Quick-access wallet card is shown only when the user holds top-up credits (TW-DASH-007).

Connections to other domains (by id): message and conversation data from CHAT, TIB1, BCAST, CAMP, SCHED, TPL; engine and device state from WADEV, WABA, NODE; contacts from CON; deals from DEAL; flows from FLR/FLB; audit rows from NOTIF; orders, packages and gateway slugs from PLAN, PAYGW, CPN; currency and timezone helpers from CPN and SET; plan/role gates from PLAN and RBAC; support tickets from SUPP; the shell (layouts, header, sidebar, tour) from ASHELL.

Conventions used in this file:

- "Out" = `direction = 'out'`, "In" = `direction = 'in'`. "Both stores" = the legacy `messages` table plus `inbox_messages`; every workspace count in this domain is the sum of both (TW-DASH-002).
- "Window" = the selected date range; "previous window" = the comparison period used for trend pills.
- Amounts marked "paid revenue" are `COALESCE(orders.total_amount, orders.amount)` over orders with `status = 'paid'` unless stated.
- QUIRK marks behavior that looks wrong but is what v1.7.0 actually does; each is repeated under Open questions & quirks where the rebuild has to decide.

## Scope notes (what is NOT in this domain)

Other pages in Reference are also "dashboards" but belong to the domain that owns their data; they reuse the chart layer described in TW-DASH-052. They are listed with their owners in Open questions & quirks so nothing is orphaned: admin AI dashboard (AIADM), BSP dashboard (BSP), package analytics / premium page (PLAN), billing-history and order-history analytics (WALLET/PLAN/CHK), support reports (SUPP), settings analytics (SET), team-inbox team/AI analytics and stats API (TIB2), flows analytics (FLR), deals reports and CRM dashboard (DEAL), Meta Ads analytics (MADS), per-channel insights pages (FB, LINE, TT, VIB, WECH), Shopify / WooCommerce / HubSpot / Slack / Trello dashboards (ECOM, INTG), WABA account health (WABA), device and workspace detail charts (WADEV, WSP), campaign/broadcast/scheduled detail charts (CAMP, BCAST, SCHED), webhook, activity-log, message-history and affiliate-history charts (INTG, NOTIF, CHAT, CPN).

## Feature index

| Id          | Feature                                                                            | Status      | Priority | Effort | Depends on                                                                           |
| ----------- | ---------------------------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------------------------------------------------------------------ |
| TW-DASH-001 | Workspace home router and dashboard access                                         | implemented | P0       | S      | TW-RBAC (workspace roles), TW-AUTH (login redirect), TW-WSP (current workspace)      |
| TW-DASH-002 | Workspace metrics scoping and message-classification rules                         | implemented | P0       | L      | TW-CHAT (messages), TW-TIB1 (conversations), TW-WADEV / TW-WABA (engine set), TW-WSP |
| TW-DASH-003 | Dashboard date-range window and previous-period comparison                         | implemented | P0       | M      | TW-DASH-002                                                                          |
| TW-DASH-004 | Dashboard KPI card: Messages sent                                                  | implemented | P0       | S      | TW-DASH-002, TW-DASH-003                                                             |
| TW-DASH-005 | Dashboard KPI card: Read rate                                                      | implemented | P0       | S      | TW-DASH-002, TW-DASH-003                                                             |
| TW-DASH-006 | Dashboard KPI card: Active contacts                                                | implemented | P1       | S      | TW-CON, TW-DASH-003                                                                  |
| TW-DASH-007 | Dashboard KPI card 4: Wallet balance or "Get more done"                            | implemented | P2       | S      | TW-WALLET, TW-CPN                                                                    |
| TW-DASH-008 | Instagram roll-up band (dashboard and analytics)                                   | implemented | P2       | M      | TW-IG, TW-TIB1                                                                       |
| TW-DASH-009 | Quick-access shortcut tiles (dashboard grid, editor, persistence)                  | implemented | P2       | M      | TW-ASHELL                                                                            |
| TW-DASH-010 | Global Quick-access edge drawer                                                    | implemented | P2       | S      | TW-DASH-009                                                                          |
| TW-DASH-011 | Sales-pipeline KPI strip                                                           | implemented | P2       | S      | TW-DEAL, TW-PLAN, TW-CPN                                                             |
| TW-DASH-012 | Dashboard message throughput chart (four ranges) with peak and average             | implemented | P0       | M      | TW-DASH-002, TW-DASH-003                                                             |
| TW-DASH-013 | Dashboard "Active campaigns" broadcast progress card                               | implemented | P1       | S      | TW-BCAST                                                                             |
| TW-DASH-014 | Dashboard "Connected devices" card (multi-engine)                                  | implemented | P1       | M      | TW-WADEV, TW-WABA                                                                    |
| TW-DASH-015 | Dashboard "Top performing templates" table                                         | implemented | P1       | S      | TW-TPL                                                                               |
| TW-DASH-016 | Dashboard live inbox preview                                                       | implemented | P1       | S      | TW-TIB1                                                                              |
| TW-DASH-017 | Dashboard Flow Copilot card and Automation flows list                              | implemented | P2       | S      | TW-FLB, TW-FLR, TW-AIAG                                                              |
| TW-DASH-018 | Dashboard engagement funnel                                                        | implemented | P1       | S      | TW-DASH-002                                                                          |
| TW-DASH-019 | Dashboard workspace activity log widget                                            | implemented | P2       | S      | TW-NOTIF (audit log)                                                                 |
| TW-DASH-020 | Dashboard quick actions and integrations health cards                              | partial     | P2       | S      | TW-INTG, TW-ECOM                                                                     |
| TW-DASH-021 | Dashboard throughput CSV export (client side)                                      | implemented | P2       | S      | TW-DASH-012                                                                          |
| TW-DASH-022 | Workspace analytics page: access, plan gate and date filter                        | implemented | P0       | M      | TW-PLAN (feature flag), TW-RBAC, TW-DASH-002                                         |
| TW-DASH-023 | Analytics headline, hero KPI card and trend stat cards                             | implemented | P0       | M      | TW-DASH-022                                                                          |
| TW-DASH-024 | Analytics volume trend, daily totals and delivery-rates charts                     | implemented | P0       | M      | TW-DASH-022                                                                          |
| TW-DASH-025 | Analytics engagement funnel with previous-period delta                             | implemented | P1       | S      | TW-DASH-022, TW-DASH-018                                                             |
| TW-DASH-026 | Analytics per-device send chart and device health                                  | partial     | P1       | M      | TW-WADEV, TW-WABA, TW-DASH-002                                                       |
| TW-DASH-027 | Analytics message-type mix                                                         | implemented | P2       | S      | TW-DASH-022                                                                          |
| TW-DASH-028 | Analytics top templates and top contacts lists                                     | implemented | P2       | S      | TW-TPL, TW-TIB1                                                                      |
| TW-DASH-029 | Analytics geography (device region) and event stream                               | partial     | P2       | S      | TW-WADEV, TW-DASH-026                                                                |
| TW-DASH-030 | Analytics team performance table                                                   | implemented | P1       | M      | TW-TIB2 (assignment, first response, resolution), TW-TIB1                            |
| TW-DASH-031 | Analytics best-hours heatmap (hour x weekday)                                      | implemented | P2       | S      | TW-DASH-022                                                                          |
| TW-DASH-032 | Analytics CSV export                                                               | partial     | P2       | S      | TW-DASH-022                                                                          |
| TW-DASH-033 | Scheduled analytics report ("Schedule report") and Meta Ads summary on analytics   | docs-only   | P2       | M      | TW-DASH-022, TW-SCHED                                                                |
| TW-DASH-034 | Admin overview page and time-window picker                                         | implemented | P0       | M      | TW-ASHELL (admin layout), TW-RBAC (platform admin), TW-DASH-035 to TW-DASH-040       |
| TW-DASH-035 | Admin overview KPI cards (income, profit estimate, views, conversion)              | implemented | P0       | S      | TW-DASH-034, TW-PLAN/TW-PAYGW (orders)                                               |
| TW-DASH-036 | Admin overview revenue-over-time chart with target line                            | implemented | P1       | M      | TW-DASH-034                                                                          |
| TW-DASH-037 | Admin overview geography panels (sessions by country, sales by region)             | partial     | P2       | S      | TW-AUTH (signup country), TW-DASH-034                                                |
| TW-DASH-038 | Admin overview sales-by-platform donut and registered-users radial                 | implemented | P2       | S      | TW-PAYGW, TW-PLAN, TW-DASH-034                                                       |
| TW-DASH-039 | Admin overview workspace activity table                                            | implemented | P1       | S      | TW-WSP, TW-PLAN                                                                      |
| TW-DASH-040 | Admin overview alerts panel                                                        | implemented | P1       | S      | TW-PAYGW (failed orders), TW-WSP                                                     |
| TW-DASH-041 | Admin analytics page shell, days filter and section tabs                           | implemented | P1       | M      | TW-ASHELL, TW-DASH-034                                                               |
| TW-DASH-042 | Admin analytics KPI strip and "Platform pulse"                                     | implemented | P1       | S      | TW-DASH-041                                                                          |
| TW-DASH-043 | Admin analytics charts, leaderboard and action queue                               | implemented | P1       | M      | TW-DASH-041                                                                          |
| TW-DASH-044 | Admin analytics signups CSV export                                                 | implemented | P2       | S      | TW-DASH-041                                                                          |
| TW-DASH-045 | Admin financial dashboard KPIs (revenue, MRR, ARR, refunds, outstanding)           | implemented | P0       | M      | TW-PLAN, TW-PAYGW, TW-CPN                                                            |
| TW-DASH-046 | Admin financial charts (revenue vs refunds, gateway mix, order status mix)         | implemented | P1       | S      | TW-DASH-045                                                                          |
| TW-DASH-047 | Admin financial tables (top paying workspaces, recent orders)                      | implemented | P1       | S      | TW-DASH-045                                                                          |
| TW-DASH-048 | System health: overall banner, core probes and 20-second live refresh              | implemented | P0       | M      | TW-NODE, TW-SET (storage), TW-CORE                                                   |
| TW-DASH-049 | System health: response-time bars, 14-day throughput and 24-hour activity counters | implemented | P1       | S      | TW-DASH-048                                                                          |
| TW-DASH-050 | System health: WhatsApp engine cards and host vitals                               | implemented | P1       | S      | TW-DASH-048, TW-WADEV, TW-WABA                                                       |
| TW-DASH-051 | System health: clear pending and failed jobs                                       | implemented | P2       | S      | TW-DASH-048                                                                          |
| TW-DASH-052 | Chart rendering layer (ApexCharts, theme tokens, page initializers)                | implemented | P0       | M      | TW-ASHELL (layouts, theme), TW-SET (theme/branding tokens)                           |
| TW-DASH-053 | Time zone, currency and number-format conventions on report pages                  | implemented | P1       | S      | TW-CPN (currency), TW-SET (timezone), TW-I18N                                        |
| TW-DASH-054 | Dead and legacy code in the dashboard area                                         | dead-code   | P2       | S      | none                                                                                 |

## Features

### TW-DASH-001 — Workspace home router and dashboard access

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-RBAC (workspace roles), TW-AUTH (login redirect), TW-WSP (current workspace)
- **Summary:** After login the user hits `/home`, which sends platform admins to the admin overview, agents and viewers to the team inbox, and everyone else to the workspace dashboard. `/dashboard` is a manager-and-above surface that renders the whole operator overview for the user's current workspace.
- **Actors & access:** Any signed-in user reaches `/home`. `/dashboard` requires workspace role >= manager (hierarchy owner > admin > manager > agent > viewer). Platform admins (Spatie role admin/super-admin or legacy `users.role` in admin, super-admin, super_admin, platform-admin) bypass the role gate and are never redirected away, even on a workspace they are not a member of. Agents and viewers are redirected (not 403) to `/team-inbox` with a warning flash "Your role (x) doesn't have access to that page". A manager-or-above failing a higher gate gets 403. A user with no workspace at all is sent to `register.workspace` (onboarding step 2); a user with workspaces but no role on the current one is sent to `/team-inbox`. No plan gate on the dashboard itself.
- **UX & screens:** `resources/views/user/dashboard/index.blade.php` inside the user layout (`nav-key=dashboard`, page key `user-dashboard-index`). Header block: eyebrow "Operator Dashboard" with a pulsing "Live · synced 4s ago" label (static text, never updates), a greeting "Good morning/afternoon/evening, {name}." (before 12:00 / before 17:00 / else, evaluated in the workspace timezone, falling back to `app.timezone`), then either "{n} broadcast(s) are running." (n>0 running broadcasts) or "Workspace is calm."; sub-line "{weekday, Month d} · {range label} showing {sent} outbound, {deliverability}% deliverability across {n} connected device(s)." Buttons: Export (TW-DASH-021), date-range dropdown (TW-DASH-003), "New campaign" linking to `/wa-campaigns/create`. Empty workspace renders every card in its empty state (zeros, "No conversations yet", "No devices connected" etc.); nothing errors when there is no data.
- **Endpoints:**

| Method uri    | Route name     | Controller@action             | Middleware                   | Request          | Response                                  |
| ------------- | -------------- | ----------------------------- | ---------------------------- | ---------------- | ----------------------------------------- |
| GET home      | home           | Closure (routes/web.php)      | auth                         | none             | 302 to /admin, /team-inbox, or /dashboard |
| GET dashboard | user.dashboard | UserPagesController@dashboard | auth, workspace.role:manager | `range` optional | HTML page                                 |

- **Data:** reads (see TW-DASH-002 and the per-card features): users (current_workspace_id, name, wallet_credits, quick_access), workspaces (timezone, currency), messages, inbox_messages, conversations, contacts, broadcasts, wa_templates, devices, wa_provider_configs, flows, flow_subscribers, deals, audit_logs, webhook_deliveries, workspace_ig_accounts. Writes nothing.
- **Rules & edge cases:**
  1. `/home` order of checks: platform admin first, then role agent/viewer, else dashboard.
  2. The old `/` route now serves the public landing page (CMS); `/home` is the in-app entry.
  3. Greeting name falls back to "there"; date uses `l, F j` format in workspace timezone.
  4. No caching: every request recomputes all cards (dozens of queries per view; see Open questions on performance).
  5. Switching workspace (header switcher, WSP) changes `users.current_workspace_id` and re-scopes every card on next load.
  6. While a platform admin impersonates a workspace, `current_workspace_id` is swapped to the client's workspace but the authenticated user stays the admin; device queries then drop the personal-orphan fallback (TW-DASH-014).
- **Async & events:** none. The "auto-refresh" wording on the Activity log card is cosmetic; the page has no polling and no websocket subscription.
- **External systems:** none.
- **Settings:** `SystemSetting credits_per_message` (wallet estimate, TW-DASH-007), workspace `timezone`, `app.timezone`.
- **Acceptance criteria:**
  - Given a signed-in platform admin, When they open `/home`, Then they are redirected to `/admin`.
  - Given a signed-in agent or viewer, When they open `/dashboard`, Then they are redirected to `/team-inbox` with a warning flash and no dashboard data is rendered.
  - Given a signed-in manager on workspace A, When they open `/dashboard`, Then every figure is scoped to workspace A only and none of workspace B's rows appear.
  - Given a workspace with no data, When the manager opens `/dashboard`, Then the page renders with zeros and empty-state panels and no server error.
  - Given the local time in the workspace timezone is 13:00, When the page renders, Then the greeting reads "Good afternoon".
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard), routes/web.php (home, dashboard), app/Http/Middleware/EnsureWorkspaceRole.php, resources/views/user/dashboard/index.blade.php, resources/js/charts/user-dashboard-index.js, Documentation/pages/getting-started/dashboard.html
- **Port notes:** New surface; nothing exists in `apps/api/src/modules` yet. Suggested: `apps/api/src/modules/analytics` (workspace read models, one endpoint per card group) + `apps/web/app/(app)/dashboard`. Use permission keys instead of the role-rank check (see RBAC mapping). Fan the cards out as separate cheap queries so one slow card does not block the page; all queries run under RLS with the org id from the session, never a client-supplied id.

### TW-DASH-002 — Workspace metrics scoping and message-classification rules

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-CHAT (messages), TW-TIB1 (conversations), TW-WADEV / TW-WABA (engine set), TW-WSP
- **Summary:** The single set of definitions every dashboard and analytics number is built from: which rows belong to the workspace, which engines count, what "sent", "delivered", "read", "failed", "queued", "reply" mean, and how deltas are computed. The rebuild must implement these once in a shared metrics service and reuse it on every card.
- **Actors & access:** Internal; used by TW-DASH-003 to TW-DASH-021 and TW-DASH-022 to TW-DASH-033.
- **UX & screens:** None directly. Visible effects: numbers on every card and the "Stats match your channel" behavior described in the docs.
- **Endpoints:** None.
- **Data:** `messages` (legacy: campaigns, broadcasts, scheduled, quick sends; has `workspace_id`, `user_id`, `provider`, `direction`, `status`, `template_id`, `media_type`, `read_at`, `from_number`), `inbox_messages` (team inbox, chat and all channel messages; NO `workspace_id`, scoped through `conversations.workspace_id`; has `provider`, `direction`, `status`, `template_id`, `media_type`, `read_at`), `conversations` (`workspace_id`, `provider`, `channel`, `device_id`, `archived`, `unread_count`, `last_message_at`, `assignee_user_id`, `first_response_at`, `resolved_at`). `to_number`, `from_number`, `body`, `failure_reason` are encrypted-at-rest columns and cannot be filtered or grouped in SQL.
- **Rules & edge cases:**
  1. Workspace scope for `messages`/`contacts`/`broadcasts`/`flows`/`wa_templates`: `workspace_id = ws` OR (`workspace_id IS NULL` AND `user_id` in the users whose `current_workspace_id = ws`) — the legacy NULL-workspace fallback. With no workspace: `user_id` in the viewer only. Inbox messages use the same rule applied to their parent conversation. QUIRK: the fallback makes a NULL-workspace row visible to every user currently parked on that workspace. The rebuild has no NULL-workspace rows (every row carries `org_id`), so drop the fallback.
  2. Engine scope ("current engine"): a row counts only if its `provider` is in the workspace's enabled-engine set OR its `channel` is one of the engine-agnostic channels currently connected (always `chatbot_widget`; plus instagram, facebook, tiktok, telegram, line, wechat, viber, email, sms when connected). The enabled set = platform-allowed methods ∩ the workspace's `enabled_engines` subset ∩ connected engines (baileys counts as connected when the workspace owns a device or is a legacy orphan install), plus any connected official (waba/twilio) config always added ("coexistence"). Cached 5 seconds per workspace. Applied on the dashboard for messages, inbox messages, broadcasts, conversations; on the analytics page for the current window but NOT for the previous window or the funnel repliers (QUIRK: makes trend deltas inconsistent).
  3. Delivered = status in {delivered, read, sent}; QUIRK: `sent` counts as delivered. Failed = status `failed`. Read = Out rows with `read_at` set OR status `read` (either signal; WABA stamps `read_at` while status can stay `delivered`). Reply = In row. Sent = all Out rows regardless of status (including pending/queued/failed). Queued (analytics only) = max(0, sent - delivered - failed).
  4. Rates: deliverability = delivered/sent*100, read rate = read/sent*100, reply rate = In/Out*100 (may exceed 100), all rounded to 1 decimal; zero denominator gives 0.
  5. Percent change = if previous <= 0 then (current > 0 ? 100.0 : 0.0) else round((current - previous)/previous*100, 1). Rate deltas are percentage points: round(currentRate - previousRate, 1), shown "pp".
  6. Eloquent queries exclude soft-deleted messages (`deleted_at`); raw `DB::table` queries in the admin surfaces do not (see admin features).
  7. Templates are referenced by `template_id` on messages; "Template" message type = `template_id` not null, taking precedence over `media_type`.
  8. Timestamps are stored UTC; window boundaries use the application timezone (`app.timezone`), NOT the workspace timezone, except the heatmap (TW-DASH-031) and greeting (TW-DASH-001).
  9. No rows are pre-aggregated; every count is a live COUNT over the raw tables.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** platform `allowed_send_methods`, workspace `enabled_engines` / `default_engine` (WADEV), `app.timezone`.
- **Acceptance criteria:**
  - Given 10 Out rows in `messages` and 5 Out rows in `inbox_messages` for the workspace, When "Messages sent" is computed for the window, Then it is 15.
  - Given an Out row with `read_at` set and status `delivered`, When Read rate is computed, Then it counts as read.
  - Given previous-window sent = 0 and current = 4, When the delta is computed, Then it is +100.
  - Given rows belonging to another workspace or a disabled engine, When metrics are computed, Then they are excluded.
  - Given a soft-deleted message in the window, When metrics are computed, Then it is excluded.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard, analytics), app/Models/Concerns/HasEngineScope.php, app/Models/Conversation.php (scopeForCurrentEngine, scopeDeviceAlive), app/Services/WorkspaceEngine.php (enginesFor), Documentation/pages/getting-started/dashboard.html, Documentation/pages/growth/analytics.html
- **Port notes:** Build `MetricsRepository` in `apps/api/src/modules/analytics` on top of the unified message table used by the inbox module (Reference's two-table split should not be reproduced; keep one `direction`, `status`, `read_at`, `provider` model and index `(org_id, created_at)`). Use SQL `date_trunc` at the workspace timezone rather than loading rows into memory. Decide status vocabulary once (map provider states to pending/sent/delivered/read/failed) and treat `sent` as "handed to provider", not delivered, only if the product owner agrees to diverge (record the decision).

### TW-DASH-003 — Dashboard date-range window and previous-period comparison

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-DASH-002
- **Summary:** A header dropdown and four in-card buttons choose 24h, 7d, 30d or quarter-to-date; choosing one reloads the page with `?range=` so the KPI cards, trend pills and chart all recompute for that window against the equal-length window before it.
- **Actors & access:** Same as TW-DASH-001.
- **UX & screens:** Header pill "Last 7 days" (menu: Last 24 hours, Last 7 days, Last 30 days, Quarter to date), and the throughput card buttons 24h / 7d / 30d / QTD; both call the same function that sets `range` in the URL and reloads. Clicking outside closes the menu. Default 7d.
- **Endpoints:** part of `GET dashboard?range=24h|7d|30d|qtd`. Any other value silently falls back to `7d`.
- **Data:** reads only.
- **Rules & edge cases:**
  1. 24h: from = now - 1 day (exact instant), to = now. 7d: from = start of day 7 days ago, to = end of today (so 8 calendar days). 30d: from = start of day 30 days ago, to = end of today (31 days). qtd: from = start of the current calendar quarter, to = end of today; span in days = days from quarter start to now + 1.
  2. Previous window: prevTo = from - 1 second; prevFrom = start of day of (prevTo - spanDays days). QUIRK: because of the start-of-day snap the previous window is slightly longer than the current one (24h: about 2 days) so trend pills are approximate.
  3. KPI header sub-line and pill labels are NOT range-aware: the first card is always titled "Messages sent · 7d" and the funnel says "last 7 days" whatever range is selected. QUIRK; the rebuild should label from the range.
  4. The range is a query param only; it is not persisted per user.
  5. The chart carries all four ranges' datasets in the page (TW-DASH-012); the buttons still reload the page rather than switch client-side.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `?range=30d`, When the page renders, Then the header label reads "Last 30 days", the KPI cards use the 30-day window, and the chart opens on the 30d dataset with the 30d button highlighted.
  - Given `?range=bogus`, When the page renders, Then it behaves as 7d.
  - Given the user clicks the "QTD" button, When the click is handled, Then the browser navigates to the same URL with `range=qtd`.
  - Given previous window has no sends and the current has some, When the Messages-sent pill renders, Then it shows +100%.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard lines for range switch), resources/js/charts/user-dashboard-index.js, resources/views/user/dashboard/index.blade.php
- **Port notes:** Model as a `range` enum plus computed `[from,to,prevFrom,prevTo]` in the workspace timezone; make prev window exactly equal length. Keep the URL-param contract so links are shareable.

### TW-DASH-004 — Dashboard KPI card: Messages sent

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-DASH-002, TW-DASH-003
- **Summary:** Big number of outbound messages in the window with delivered and failed counts, a trend pill versus the previous window, and a 20-bar hourly sparkline.
- **Actors & access:** As TW-DASH-001.
- **UX & screens:** Card 1 of the KPI row (`data-tour="kpi"`): label "Messages sent · 7d" (static), pill ▲/▼ + abs(delta) % (green when delta >= 0, coral when negative), value `sent`, legend "{delivered} delivered" and "{failed} failed", and a sparkline (`#kpi-spark`, ApexCharts sparkline bar chart, series "Sent/hr", bars colored teal when value 0-9 and green when >= 10, tooltip "N msg/h"; renders `[0]` when empty).
- **Endpoints:** part of `GET dashboard`.
- **Data:** counts per TW-DASH-002 for Out rows in the window (both stores, engine-scoped). Sparkline: 20 hourly slots, slot h = (now - (h+1) hours, now - h hours) for h = 19..0, both stores, engine-scoped, both boundaries inclusive (QUIRK: a message exactly on a boundary is counted in two slots).
- **Rules & edge cases:**
  1. delivered uses the delivered set (includes `sent`), failed = status failed.
  2. Delta = percent change of sent versus previous window (TW-DASH-002 rule 5).
  3. The sub-line in the page header reuses these numbers ("{sent} outbound, {deliverability}% deliverability across {n} connected devices").
  4. Numbers use thousands separators; the throughput card legend abbreviates as 1.2k / 1.5M.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 100 Out messages in the window (80 delivered/read/sent, 5 failed), When the card renders, Then it shows 100, "80 delivered", "5 failed".
  - Given the previous window had 50 sends, When 100 are sent now, Then the pill shows ▲ 100%.
  - Given no sends in the last 20 hours, When the sparkline renders, Then it draws a single zero bar without error.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard: sent24h, sparkData), resources/views/user/dashboard/index.blade.php, resources/js/charts/user-dashboard-index.js
- **Port notes:** Endpoint `GET /analytics/dashboard/summary?range=`; sparkline as `GET .../hourly?hours=20`. Variable names in Reference (`sent24h`) are misleading: they hold the selected-window value.

### TW-DASH-005 — Dashboard KPI card: Read rate

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-DASH-002, TW-DASH-003
- **Summary:** Percentage of sent messages that were read, with a radial gauge and a three-step "Sent 100% / Deliv x% / Read y%" strip; trend pill in percentage points.
- **Actors & access:** As TW-DASH-001.
- **UX & screens:** Card 2: label "Read rate", pill ▲/▼ abs(pp) "pp" (neutral grey when up, coral when down), value `readRatePct` with "%" and a 64px radialBar (`#kpi-readrate`, single value, one decimal, track tinted ink 6%). Bottom strip: Sent = "100%" if sent > 0 else "0%", Deliv = deliverability %, Read = read rate %.
- **Endpoints:** part of `GET dashboard`.
- **Data:** read = Out rows with `read_at` not null OR status `read` (TW-DASH-002 rule 3); sent = all Out rows; previous window computed the same way (engine-scoped).
- **Rules & edge cases:**
  1. Read rate 0 when sent is 0.
  2. Delta in pp = round(readRate - prevReadRate, 1).
  3. Deliverability shown here equals delivered/sent (delivered includes `sent` status).
  4. Provider read receipts are the source; blue ticks disabled by the recipient never register.
- **Async & events:** none (the value moves as WABA/Baileys status webhooks update `read_at`, owned by WADEV/WABA).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 200 Out messages of which 50 have `read_at` set, When the card renders, Then Read rate shows 25.0%.
  - Given prev read rate 20% and current 25%, When the pill renders, Then it shows "5pp".
  - Given zero sends, When the card renders, Then it shows 0% and the strip shows Sent 0%.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard: readCond, readRatePct, deltaReadRate), resources/views/user/dashboard/index.blade.php, resources/js/charts/user-dashboard-index.js
- **Port notes:** Store `read_at` as first-class column; compute in SQL with `count(*) filter (where read_at is not null or status='read')`.

### TW-DASH-006 — Dashboard KPI card: Active contacts

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CON, TW-DASH-003
- **Summary:** Total contacts in the workspace with subscribed / opted-in / blocked bars and a growth pill.
- **Actors & access:** As TW-DASH-001.
- **UX & screens:** Card 3: label "Active contacts", pill ▲/▼ percent growth, value total; three bars Subscribed, Opted-in, Blocked, each width = count/total*100 (min denominator 1) with the count on the right.
- **Endpoints:** part of `GET dashboard`.
- **Data:** `contacts` scoped by the workspace fallback rule (not engine-scoped). Subscribed and Opted-in both = `is_unsubscribed = 0` (same column, so the two bars are always identical); Blocked = `is_unsubscribed = 1`. Previous count = contacts with `created_at < window start`; new = max(0, total - previous); delta = percent change of total versus previous.
- **Rules & edge cases:**
  1. QUIRK: "Active" is just "all contacts"; no activity criterion. "Opted-in" duplicates "Subscribed".
  2. Contact deletions during the window make growth understate.
  3. `newContacts` is computed but not rendered.
  4. Not gated by any plan limit.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 120 contacts of which 20 unsubscribed, When the card renders, Then Subscribed = 100, Blocked = 20 and total = 120.
  - Given 100 contacts existed before the window and 120 exist now, Then the pill shows ▲ 20%.
  - Given no contacts, When rendered, Then value 0 and all bars 0 width.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard contacts roll-up), resources/views/user/dashboard/index.blade.php
- **Port notes:** Consider a real "opted-in" (consent) state from CON if it exists; otherwise keep parity and show two bars.

### TW-DASH-007 — Dashboard KPI card 4: Wallet balance or "Get more done"

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WALLET, TW-CPN
- **Summary:** The fourth card shows the user's top-up wallet balance as money when they hold credits, otherwise a call-to-action card pointing at Flows and Campaigns.
- **Actors & access:** As TW-DASH-001. Reads the signed-in user's own `wallet_credits`, not a per-workspace figure.
- **UX & screens:** If `wallet_credits > 0`: label "Wallet balance" (+ "pay per message" chip when the workspace bills per message), money value (auto-shrinks font by string length: <=9 chars large, <=12 medium, else small), links "Earn via affiliate" (`/account?tab=affiliate`) and "Top up" (`/account?tab=wallet`), full-width bar. Money = credits * `MessageCreditRate::minorPerCredit()` / 100 formatted in the viewer's currency. Else: "Get more done - Put replies on autopilot" with buttons "Build a flow" (`/flows`) and "New campaign" (`/campaigns`).
- **Endpoints:** part of `GET dashboard`.
- **Data:** `users.wallet_credits`, `SystemSetting credits_per_message` (default 1; `estMessages` = floor(credits / per-message), computed but not shown), workspace billing mode (`MessageBillingService::payPerMessageFor`).
- **Rules & edge cases:**
  1. Card is hidden entirely for plan/allowance billing where credits are 0 (credits were "reverted" in Reference; comment in code).
  2. Bar width is 100% whenever credits > 0 (decorative).
  3. Money formatting follows `FormatSettings::display` for the user's workspace currency.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `credits_per_message`; wallet rate from WALLET.
- **Acceptance criteria:**
  - Given `wallet_credits = 0`, When the dashboard renders, Then the "Get more done" card with two buttons shows in place of the wallet card.
  - Given `wallet_credits = 500` and a rate of 2 minor units per credit, When it renders, Then the balance reads as 10.00 in the workspace currency.
  - Given the workspace is pay-per-message, Then the "pay per message" chip appears.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard credits), resources/views/user/dashboard/index.blade.php, app/Services/MessageCreditRate.php, app/Services/MessageBillingService.php
- **Port notes:** Read wallet balance from WALLET's ledger via a service call, not directly. Per-user wallet vs per-org wallet is a WALLET decision; the card just displays the org wallet.

### TW-DASH-008 — Instagram roll-up band (dashboard and analytics)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-IG, TW-TIB1
- **Summary:** When the workspace has at least one connected Instagram account, a second KPI band with Instagram DM metrics appears on the dashboard, and a wider band on analytics. Otherwise nothing renders and the page is WhatsApp-only.
- **Actors & access:** As TW-DASH-001 / TW-DASH-022. Gate: `WorkspaceIgAccount::hasConnected(ws)`; the band disappears the moment the Instaflow add-on connection is cut in admin extensions or the last account is unlinked.
- **UX & screens:** Dashboard: header strip (Instagram gradient icon, "· N account(s)", up to 4 account chips with avatar/initial and a green/amber dot, "Open inbox" link to `/team-inbox`) plus five tiles: Need reply, Open chats, DMs in 7d, DMs sent 7d, Followers (>=1000 shown as x.yk). "Need reply" and "Open chats" link to the team inbox. Analytics: same data as six stats (DMs in, DMs sent, Reply rate, Need reply, Open chats, Followers) with the account chips.
- **Endpoints:** part of `GET dashboard` and `GET analytics`.
- **Data:** `workspace_ig_accounts` (connected ones, ordered by followers desc; followers summed), `conversations` with `channel = 'instagram'` for the workspace, `inbox_messages` joined through those conversations. open = count; needsReply = unread_count > 0 OR last_inbound_at > last_outbound_at; unread = sum(unread_count); dms in/out are the last 7 days (start of day 7 days ago to now) regardless of the selected range; reply rate = round(min(100, out/in*100)), 0 if no inbound.
- **Rules & edge cases:**
  1. Any exception returns null (band hidden).
  2. 7-day window is fixed even on the analytics page with a custom range.
  3. Account handle shown as "@handle"; name falls back to handle.
  4. Not affected by the engine scope filter (channel filter instead).
- **Async & events:** none (data mirrored by the IG domain).
- **External systems:** none at render time (Instaflow mirror is read, no round-trip).
- **Settings:** admin extensions connection for Instaflow (ADD/IG).
- **Acceptance criteria:**
  - Given no connected Instagram account, When the dashboard renders, Then no Instagram section exists in the page.
  - Given two connected accounts and 3 conversations awaiting reply, When it renders, Then the band shows "2 accounts" and Need reply = 3.
  - Given DMs in = 10 and out = 15 in the last 7 days, Then reply rate = 100%.
- **Source refs:** app/Http/Controllers/UserPagesController.php (igStats), resources/views/user/dashboard/index.blade.php, resources/views/user/analytics/index.blade.php, app/Models/WorkspaceIgAccount.php
- **Port notes:** Expose as a generic "channel roll-up" widget keyed by channel so Facebook, Telegram etc. can reuse it later; IG owns the data.

### TW-DASH-009 — Quick-access shortcut tiles (dashboard grid, editor, persistence)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-ASHELL
- **Summary:** Each user pins up to 10 shortcut tiles (5x2 grid) on their dashboard, chosen from a fixed catalog of 20 app pages plus optional custom links, and saves them per user.
- **Actors & access:** Any signed-in user for their own tiles; `POST /quick-access` needs only authentication (no role or plan gate). Tiles are not filtered by role or plan, so a tile can point at a page the user cannot open.
- **UX & screens:** Dashboard section "Shortcuts / Quick access" with an Edit pencil (`data-qa-open`). Tiles show icon + label with a hover card (label + one-line description from a label-keyed map; labels without a map entry read "Open {label}"). Empty state button "Add quick-access shortcuts". Editor modal (`x-user.quick-access-modal`, global in the layout): checkbox grid "App pages (max 10)", "Custom links" rows (Label + "https://... or /path" + delete), "+ Add a custom link", live counter "{n} / 10 pinned", Cancel and "Save shortcuts". Client rules: checking an 11th item unchecks it and toasts "You can pin up to 10 shortcuts."; adding a custom row at 10 toasts the same. Escape closes. Save sends JSON `{items}`, toasts "Quick access updated." and reloads.
- **Endpoints:**

| Method uri        | Route name          | Controller@action            | Middleware | Request                                    | Response                                                   |
| ----------------- | ------------------- | ---------------------------- | ---------- | ------------------------------------------ | ---------------------------------------------------------- |
| POST quick-access | quick-access.update | QuickAccessController@update | auth       | `items`: array of `{key}` or `{label,url}` | JSON `{ok:true, tiles:[{key,label,desc,url,icon,custom}]}` |

- **Data:** `users.quick_access` JSON array (cast array), entries either `{key}` or `{label,url}`. Catalog keys (label -> url): inbox (Unified Inbox -> /team-inbox), contacts, campaigns (-> /wa-campaigns), broadcasts, templates, flows, scheduled, catalog, store, deals (Sales Pipeline), analytics, auto-reply, devices, chatbots (Chat Widgets -> /chatbot-widgets), ai (AI Assistants -> /ai-assistants), appointments, webhooks, history (Message Log -> /message-history), account, more (More apps -> /more). Default when nothing saved: inbox, contacts, campaigns, broadcasts, templates, flows, scheduled, catalog, deals, analytics.
- **Rules & edge cases:**
  1. Server sanitization: non-array input becomes empty; entries that are not arrays are skipped; an entry with a known catalog `key` becomes `{key}`; otherwise an entry needs non-empty label AND url; url must start with "/" or match `http(s)://` (so `javascript:` is rejected); label truncated to 40 chars, url to 255; list capped at 10; no de-duplication of the same key.
  2. Unknown catalog keys are silently dropped on read and write.
  3. QUIRK: saving an empty list stores `[]`, and reading treats an empty array as "never customised", so the user gets the default 10 tiles back; a user cannot end up with zero tiles.
  4. QUIRK: order is fixed by the modal (catalog order for checked items, then custom rows); there is no reordering although the drawer tooltip says "Pin or reorder".
  5. The dashboard hover text comes from a label-keyed map while the drawer uses the catalog `desc`; two different copy sets exist.
  6. Custom links open in the same tab; external URLs are accepted from any host.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user who never customised, When the dashboard renders, Then the 10 default tiles appear in the default order.
  - Given a POST with 12 valid items, When saved, Then only the first 10 are stored.
  - Given a custom link `{label:"X", url:"javascript:alert(1)"}`, When posted, Then it is dropped.
  - Given a POST with a 60-char label, When saved, Then the stored label is 40 chars.
  - Given a POST of an empty `items`, When the dashboard next loads, Then the default tiles show.
- **Source refs:** app/Http/Controllers/QuickAccessController.php, app/Support/QuickAccess.php, resources/views/components/user/quick-access-modal.blade.php, resources/views/user/dashboard/index.blade.php, resources/js/app.js (initQuickAccessModal), resources/js/charts/user-dashboard-index.js (unused copy), database/migrations/2026_06_24_180000_add_quick_access_to_users.php
- **Port notes:** Store as `user_preferences.quick_access jsonb` (per user, not per org; org-scoped by RLS if the table is org-keyed); validate with a Zod schema in `@crm/contracts`; make empty list a valid saved state; add ordering. Link catalog must map to the new app's routes and permission keys.

### TW-DASH-010 — Global Quick-access edge drawer

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-DASH-009
- **Summary:** A draggable grip on the right edge of every workspace page slides out a vertical column of the user's pinned shortcuts plus fixed Dashboard, All apps, Edit and Close buttons.
- **Actors & access:** Any signed-in workspace user (rendered by the user layout).
- **UX & screens:** `components/user/quick-access-drawer.blade.php`: grip button `#qad-handle` (default top 120px; drag vertically to reposition, clamped 8px to viewport-60; position persisted in browser localStorage key `qadHandleTop`; drag under 4px counts as a click), click toggles panel `#qad-panel` (translate-x), click-away backdrop, Escape and a Close button close it. Each icon shows a dark hover card (label + description) rendered on body and flipped to the right if there is no room on the left. Fixed trailing buttons: Dashboard (`/dashboard`), All apps (`/more`), Edit shortcuts (opens TW-DASH-009 modal).
- **Endpoints:** none (uses the tiles already resolved for the page).
- **Data:** `users.quick_access` via `QuickAccess::forUser`.
- **Rules & edge cases:**
  1. Drawer renders only if the resolved tile list is non-empty (always true, defaults apply).
  2. Handle position is per browser, not per account.
  3. Tooltips use `data-qtip`/`data-qdesc`; accessible names come from aria-label.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given any workspace page, When the grip is clicked, Then the panel slides in showing the pinned tiles.
  - Given the grip is dragged 100px down, When released, Then it stays there after reload (same browser).
  - Given the panel is open, When Escape is pressed, Then it closes.
- **Source refs:** resources/views/components/user/quick-access-drawer.blade.php, resources/js/app.js (initQuickAccessDrawer), resources/views/components/layouts/user.blade.php
- **Port notes:** Belongs in the app shell (`apps/web` layout); coordinate with ASHELL. Persist position in localStorage only (try/catch).

### TW-DASH-011 — Sales-pipeline KPI strip

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-DEAL, TW-PLAN, TW-CPN
- **Summary:** When the plan includes the sales pipeline, four deal KPIs (open pipeline value, open deals, won this month, win rate) show on the dashboard and link to `/deals` and `/deals/reports`.
- **Actors & access:** Shown only if plan feature `access_sales_pipeline` is on for the workspace (platform admins bypass). Otherwise the section is absent (null).
- **UX & screens:** "Sales Pipeline" panel (`data-tour="pipeline"`), link "Open board", four tiles: Open pipeline (money), Open deals (count), Won this month (money), Win rate (%).
- **Endpoints:** part of `GET dashboard`.
- **Data:** `deals` scoped by `Deal::forCurrentWorkspace()`; `value_minor` (bigint minor units) + `currency`. Each deal is converted from its own currency to the workspace display currency (`workspaces.currency`, else admin `default_currency`) via stored exchange rates, then summed. open = status `open`; won this month = status `won` and `won_at >= start of current month`; win rate = round(won_all/(won_all+lost_all)*100), 0 if none.
- **Rules & edge cases:**
  1. Any exception hides the strip.
  2. Minor-unit math assumes 2 decimals (/100).
  3. Win rate is all-time, not windowed; "won this month" ignores the selected range.
  4. Currency shown in the workspace's chosen currency, not the pipeline's.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin `default_currency`, currency rates table.
- **Acceptance criteria:**
  - Given a plan without `access_sales_pipeline`, When the dashboard renders, Then the strip is absent.
  - Given deals of 100 USD and 8000 INR open in a GBP workspace, Then Open pipeline is their converted sum in GBP.
  - Given 3 won and 1 lost deals all time, Then Win rate shows 75%.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dealStats), resources/views/user/dashboard/index.blade.php, app/Support/FormatSettings.php
- **Port notes:** Call DEAL's stats service (`DealsStatsService.summary(orgId, currency)`); keep conversion in CPN. Keep gating by entitlement key.

### TW-DASH-012 — Dashboard message throughput chart (four ranges) with peak and average

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-DASH-002, TW-DASH-003
- **Summary:** A grouped bar chart of Sent / Delivered / Failed per bucket with 24h (hourly), 7d (daily), 30d (daily) and quarter-to-date (daily) datasets, a legend with totals, a "Peak hour" chip, and a four-tile footer (Avg per hour, Replies, Reply rate, Failed).
- **Actors & access:** As TW-DASH-001.
- **UX & screens:** Card "Message throughput" with a "UTC+1" badge (hard-coded text, QUIRK: not the real zone), subtitle that changes by range ("Outbound, delivered & failed events - hourly, last 24h" / "daily, last 7 days" / "daily, last 30 days" / "daily, quarter to date"), range buttons 24h/7d/30d/QTD (active one dark), legend "Sent {n}", "Delivered {n}", "Failed {n}" abbreviated (k/M), optional "Peak hour {weekday HH:00} · {n} msg", chart `#chart-throughput` (ApexCharts bar, height 220, columnWidth 55%, radius 3, colors deep green / green / coral, shared tooltip "N msg", y-axis 1000 -> "1k", x labels rotated -45 with overlap hidden; a resize event is dispatched 300 ms after render to fix label clustering after card animations). Footer tiles: Avg / hour, Replies, Reply rate %, Failed.
- **Endpoints:** part of `GET dashboard`; all four datasets are embedded in the page as `window.DASHBOARD_DATA.throughputRanges` (labels, sent, delivered, failed), plus legacy 8-day `labels/sent/delivered/failed`, `spark`, `readRate`, `activeRange`.
- **Data:** Out rows from both stores, engine-scoped. Bucketing is done in PHP after loading `created_at,status` of every row in the window: 24h = 24 hourly buckets from (now - 23h, start of hour) labelled `H:00`; 7d = 8 daily buckets from start of day 7 days ago labelled by weekday (`D`, QUIRK: labels repeat, e.g. two "Mon"); 30d = 30 daily buckets from start of day 29 days ago labelled `M d`; qtd = one bucket per day from quarter start labelled `M d`. Each Out row increments Sent; status `failed` increments Failed; status in delivered set increments Delivered; pending/queued rows count only in Sent. Peak/avg: hourly Out counts for the 24 hourly slots (now - 24h ... now), NOT engine-scoped (QUIRK), peak = max slot (label `D H:00`), average = round(sum/24).
- **Rules & edge cases:**
  1. The chart opens on the server's active range (same as the KPI cards); clicking a range button reloads with `?range=` (TW-DASH-003), it does not swap datasets client-side.
  2. Legend totals and footer use the KPI window totals, not the sum of chart buckets (they differ when the window is 24h because buckets span whole hours).
  3. Performance: all four ranges are always built, loading every outbound row of the quarter into memory. The rebuild should aggregate in SQL and only build the requested range (plus lazy-load the others if a client-side toggle is desired).
  4. Reply rate in the footer = In/Out*100 for the window; Failed repeats the KPI value.
  5. Empty windows render a flat chart, not an error.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none. Colors come from theme tokens (TW-DASH-052).
- **Acceptance criteria:**
  - Given `range=24h`, When the chart renders, Then it has 24 bars per series labelled 00:00-23:00 in hourly order ending at the current hour.
  - Given a failed Out message at 10:15 today, When the 7d chart renders, Then today's Failed bar is 1 and its Sent bar includes it while Delivered does not.
  - Given the user clicks 30d, When the page reloads, Then the 30d dataset shows and the 30d button is active.
  - Given the busiest hour in the last 24h had 40 sends, Then the Peak hour chip shows that hour and 40.
- **Source refs:** app/Http/Controllers/UserPagesController.php (bucketRange, hourlySent, peakHour), resources/js/charts/user-dashboard-index.js, resources/views/user/dashboard/index.blade.php
- **Port notes:** `GET /analytics/dashboard/throughput?range=&tz=` returning `{labels,sent,delivered,failed}`; use `generate_series` + left join so empty buckets exist; bucket in the workspace timezone (fixes QUIRK) and label from the real zone.

### TW-DASH-013 — Dashboard "Active campaigns" broadcast progress card

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BCAST
- **Summary:** Shows counts of running, scheduled and paused/failed broadcasts and the four most recently updated broadcasts with template, status pill and a delivered/total progress bar.
- **Actors & access:** As TW-DASH-001.
- **UX & screens:** Header "Active campaigns" with "{running} running · {scheduled} scheduled · {paused} paused" and link "View all {total}" to `/broadcasts`. Each row: name (fallback "Untitled broadcast"), status pill, "{category} · {template}", "{done} / {total} delivered", progress bar and %. Empty state "No active broadcasts" with "+ New broadcast" (`/broadcasts/create`).
- **Endpoints:** part of `GET dashboard`.
- **Data:** `broadcasts` by workspace scope and engine scope. Status buckets: running = sending/running/processing/active; scheduled = scheduled/pending/queued; paused = paused/failed/cancelled (so "paused" includes failed and cancelled); total = all rows including completed. List = 4 most recently `updated_at`, regardless of status (so completed ones appear; "active" is a misnomer). Pill mapping: Sending (green), Scheduled (amber), Paused (coral, for paused/cancelled), Failed (coral), Completed (grey, for completed/done/sent), else capitalised raw status. Progress = round(success_count / total_recipients * 100), 0 when total is 0. Template category/name read from `wa_templates` by `template_id` (encrypted name is decrypted by the model).
- **Rules & edge cases:**
  1. `success_count` is the "delivered" figure; it is maintained by BCAST.
  2. Not filtered by the dashboard range.
  3. The header sentence "N broadcasts are running" uses the running count.
- **Async & events:** none (updates as the broadcast job progresses; no polling here).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 2 running, 1 scheduled, 1 failed and 3 completed broadcasts, Then the header reads "2 running · 1 scheduled · 1 paused" and "View all 7".
  - Given a broadcast with 200 recipients and 50 successes, Then its bar shows 25%.
  - Given no broadcasts, Then the empty state with the create link shows.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard broadcasts roll-up), resources/views/user/dashboard/index.blade.php
- **Port notes:** Query BCAST's campaign table read-only via a view model; keep status vocabulary mapped to the new enum.

### TW-DASH-014 — Dashboard "Connected devices" card (multi-engine)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WADEV, TW-WABA
- **Summary:** Lists up to four sending numbers across all enabled engines (unofficial devices, WhatsApp Cloud API configs, Twilio configs) with online state, and a slot counter "X of Y slots used · Z online".
- **Actors & access:** As TW-DASH-001. Platform-admin impersonation drops the personal-orphan device fallback.
- **UX & screens:** Header "Connected devices", "{total} of {slotCap} slots used · {online} online", "+ Connect". Row: status dot (green if online with glow on the first row, amber if status `connecting`, coral otherwise), phone, "{label} · {region or 'unzoned'} · {n}/24h", right side delivery % (grey >=95, amber 85-95, coral below 85) and "deliv". Empty state "No devices connected / Pair a WhatsApp number" with a "Connect a device" button (`data-connect-device`, opens the connect sheet). Footer strip when free slots remain: "{n} device slot(s) available - Add {engine list}" linking to `/devices`.
- **Endpoints:** part of `GET dashboard`.
- **Data:** For each engine in the workspace's enabled set: baileys -> `devices` visible to the viewer (`workspace_id = ws`, plus the viewer's own NULL-workspace devices unless impersonating); online = status `connected` AND `active`; waba/twilio -> `wa_provider_configs` for the workspace and provider; online = status `connected`. Slot cap = max(total senders, 6) (hard-coded 6, not the plan limit). List: baileys ordered by `active` desc, `last_seen_at` desc, `id` desc; provider configs ordered by `connected_at` desc; engines iterated default-first; capped at 4 rows total. Baileys row: phone `+{country_code} {phone}` or "-", label `device_name` else phone else "Device #id", `sent_24h`, delivery% = max(0, round((1 - failed_24h / max(1,sent_24h)) * 100, 1)). Provider row: phone digits with "+", label `display_label` else "{engine label} · {phone}", sent 0, delivery 100.
- **Rules & edge cases:**
  1. QUIRK: `devices.sent_24h` and `failed_24h` are never written by application code in v1.7.0 (only seeders and the warmer read them), so on a real install these show 0/24h and 100% delivery. The rebuild must compute them live from message status over the last 24 hours.
  2. "Slots" ignore the plan's device limit; use the plan entitlement in the rebuild.
  3. Tenant isolation: device queries use the device-specific scope (viewer-keyed orphan fallback), not the generic workspace scope, to avoid leaking an admin's personal number into a client's dashboard.
  4. Any engine failing to load simply contributes nothing.
- **Async & events:** none (status changes are pushed by WADEV; the card is static until reload).
- **External systems:** none.
- **Settings:** platform `allowed_send_methods`, workspace `enabled_engines`; connect sheet in ASHELL/WADEV.
- **Acceptance criteria:**
  - Given a workspace with 2 connected Baileys devices and 1 connected Cloud API number, Then the card reads "3 of 6 slots used · 3 online" and lists three rows.
  - Given a device with status `connecting`, Then its dot is amber and it does not count as online.
  - Given 5 senders, Then only 4 rows show and the counter still reads 5 of 6.
  - Given no senders, Then the empty state with the connect button shows.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard devices block), app/Models/Device.php (scopeForCurrentWorkspace), app/Services/WorkspaceEngine.php, resources/views/user/dashboard/index.blade.php
- **Port notes:** Read via WADEV's `SenderRegistry.list(orgId)`; compute 24h sent/failed with a windowed query; show plan device limit as the denominator.

### TW-DASH-015 — Dashboard "Top performing templates" table

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-TPL
- **Summary:** A table of the five most recently updated live templates with their sends, delivered, read, read-based CTR and a delivery performance bar, sorted by sends.
- **Actors & access:** As TW-DASH-001.
- **UX & screens:** Header "Top performing templates" with subtitle "By send volume · last 7 days · Meta-approved only" (static text; the numbers actually follow the selected range, and non-approved templates are included), a "{n} template(s)" chip and "+ New template" (`/templates/create`). Columns: Template (3-letter category badge + name + `id: tpl_{id} · {LANG}`), Type ("Category · type"), Sent, Delivered, Read, CTR, Performance bar, Status pill. Empty row "No templates yet. Create your first".
- **Endpoints:** part of `GET dashboard`.
- **Data:** templates `wa_templates` scoped by workspace, `providerLive()` (provider config null or connected), ordered by `updated_at` desc, limit 5 (QUIRK: "top" is only among the five most recently edited). For each: sends = window Out rows in `messages` (NOT `inbox_messages`) with that `template_id`, engine-scoped; delivered = those in the delivered set; read = status `read`; CTR = round(read/sends*100, 1) (it is really read rate) or null; performance = min(100, round(delivered/sends*100)); the five are then sorted by sends desc. Status pill: approved/active = Approved; pending/submitted/in_review = In review; rejected/disabled = Rejected; else capitalised. Category badge colors: marketing/utility green, authentication amber, else grey. Count chip = number of live templates.
- **Rules & edge cases:**
  1. `providerLive()` hides templates whose WABA config was removed so the count agrees with the Templates page.
  2. Cells show "-" when sends = 0.
  3. Template name is encrypted; sorting/searching must happen after decryption.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 8 templates, Then only the 5 most recently updated are listed, ordered by window sends descending.
  - Given a template with 10 sends, 9 delivered, 5 read, Then it shows Sent 10, Delivered 9, Read 5, CTR 50.0%, performance 90.
  - Given a template whose provider config is disconnected, Then it is excluded from the list and the count.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard templates), app/Models/WaTemplate.php (scopeProviderLive), resources/views/user/dashboard/index.blade.php
- **Port notes:** Proper "top by sends" is a group-by over messages joined to templates; do that and rename CTR to Read rate (real CTR needs button-click tracking from TPL/WABA `waba:sync-template-clicks`).

### TW-DASH-016 — Dashboard live inbox preview

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-TIB1
- **Summary:** Shows the three most recent conversations with preview text, relative time and unread badge, the count of unread conversations, and how long the oldest unread has been waiting.
- **Actors & access:** As TW-DASH-001. Only when the user has a current workspace.
- **UX & screens:** "Live inbox" card: "{n} unread" + "· oldest {duration}" ; "Open inbox" link; "Recent conversations" list of up to 3 rows (initials avatar with one of three rotating gradients, title, relative time, 60-char preview, unread badge), each linking to `/team-inbox`. Empty: "No conversations yet."
- **Endpoints:** part of `GET dashboard`.
- **Data:** `conversations` in the exact Team Inbox scope: workspace, engine scope, device-alive (drops conversations whose Baileys device row was deleted; waba/twilio/no-device rows kept) and `archived = false`. Top 3 by `last_message_at` desc. `unreadCount` = number of conversations with `unread_count > 0` (chats, not messages). Oldest unread = the unread conversation with the smallest `last_message_at`, shown as a short relative duration ("3 hours"). Preview = latest `inbox_messages` body by `created_at` (decrypted; 60 chars), initials = first two letters of the title. Title fallback `+{raw_jid}`.
- **Rules & edge cases:**
  1. The dashboard number intentionally matches the inbox rail (both count unread chats after the same filters); an earlier version summed unread messages and included hidden threads.
  2. Direction of the last message is fetched but not displayed.
  3. Preview of media-only messages is "-" when body is empty.
- **Async & events:** none (no realtime here; the team inbox itself is realtime).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 5 conversations of which 2 have unread messages, Then the card says "2 unread" and lists the 3 most recent conversations.
  - Given an archived conversation with unread messages, Then it is not counted.
  - Given a conversation on a deleted Baileys device, Then it is neither listed nor counted.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard liveConvos), app/Models/Conversation.php (scopeDeviceAlive), resources/views/user/dashboard/index.blade.php
- **Port notes:** Reuse TIB1's inbox list query with `limit=3`; do not duplicate the scope logic. Consider a websocket-driven refresh of this card since the inbox already has realtime.

### TW-DASH-017 — Dashboard Flow Copilot card and Automation flows list

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-FLB, TW-FLR, TW-AIAG
- **Summary:** A promo card that deep-links into the flow builder with a preset AI prompt, showing flow / active / subscriber counts, and a list of the six most recently updated flows with trigger, step count and subscriber counts.
- **Actors & access:** As TW-DASH-001. No plan gate on the card itself (the builder enforces its own).
- **UX & screens:** Copilot card: "{brand} Copilot" with "AI Powered" tag, headline "Build a flow from a sentence.", a fixed example prompt (WooCommerce order paid -> thank-you with tracking, 24h later a review request with a 10% coupon), buttons "Generate flow" (`/flows/builder?ai_prompt=<urlencoded example>`) and "Examples" (`/flows/builder?ai=1`), three stats flows / active / subscribers. "Automation flows" card: "{active} active · {subscribers} subscribers", link "Open", up to 6 rows: name (fallback "Untitled flow"), "{Trigger} trigger · {steps} steps · {subs} subscribers", Active/Paused pill, subscriber count. Empty: "No flows yet" with "Build your first flow".
- **Endpoints:** part of `GET dashboard`.
- **Data:** `flows` by workspace scope: total, `is_active = true` count; `flow_subscribers` counts by flow (total subscribers across the workspace's flows, and per flow for the list); steps = number of `flowNodes` in the decoded `flow_data` JSON; trigger = `trigger_kind` (default "keyword"). List ordered by `updated_at` desc, limit 6. Exceptions leave the list empty.
- **Rules & edge cases:**
  1. Counts ignore the range and the engine scope.
  2. Subscriber counts are lifetime enrollments, not currently active runs.
  3. `brand_name()` is the white-label product name (SET).
- **Async & events:** none.
- **External systems:** none (the Copilot itself is in FLB).
- **Settings:** brand name (SET).
- **Acceptance criteria:**
  - Given 10 flows of which 4 active, Then the card shows flows 10, active 4 and the list shows the 6 latest.
  - Given a flow with 3 nodes, Then its row shows "3 steps".
  - Given no flows, Then the empty state shows.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard flows), resources/views/user/dashboard/index.blade.php
- **Port notes:** Read from FLB via a stats query; keep the deep-link contract (`ai_prompt`, `ai=1`) for the builder.

### TW-DASH-018 — Dashboard engagement funnel

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-DASH-002
- **Summary:** Four-stage funnel: Sent, Delivered, Replied (inbound messages), Engaged (unique conversations that replied), each with count, share of Sent and drop to the next stage, and an end-to-end percentage.
- **Actors & access:** As TW-DASH-001.
- **UX & screens:** Card "Engagement funnel" (subtitle "Workspace activity · last 7 days", static) with link "view all" to `/analytics`; stage rows "01 · sent / 02 · delivered / 03 · replied / 04 · engaged" each with label ("Outbound messages", "Successfully delivered", "Inbound replies", "Unique repliers"), bar of width = share (bars are at least 0-width but rows keep equal card width), count, and "100%" for stage 1 or "↘ {drop}" after; "↓ x%" connectors; footer "end-to-end conversion {pct}%" and "{n} stages".
- **Endpoints:** part of `GET dashboard`.
- **Data:** stage1 = Out count; stage2 = delivered set count; stage3 = In count (both stores); stage4 = distinct `conversation_id` among In `inbox_messages` in the window joined to conversations of the workspace with both `conversations.provider` and `inbox_messages.provider` in the enabled engine set (the numerator uses the same set as denominators so reply rates cannot exceed 100% in a multi-engine workspace). pct = count/sent*100 (1 dp, 0 if sent = 0); drop_i = max(0, previous stage - this stage), where stage 3's drop is measured from delivered and stage 4's from replies; end-to-end = stage 4 pct.
- **Rules & edge cases:**
  1. Stage 3 can exceed stage 2 (replies are not tied to the sends), so its share can be above 100%.
  2. Engaged uses inbox messages only.
  3. Uses the selected range although the subtitle is static.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 100 sent, 90 delivered, 30 inbound messages from 20 conversations, Then stages read 100 / 90 (90%) / 30 (30%) / 20 (20%) and end-to-end 20%.
  - Given zero sends, Then all percentages are 0 and the drops are 0.
- **Redesign (intended change, user request 2026-10):** The card is now contact based, not message based: "Contacts messaged" (distinct conversations with an outbound message, 100%), "Delivered" (distinct conversations with an outbound message in the delivered set) and "Replied" (distinct conversations with an inbound message), each as a share of contacts messaged (capped at 100 when a contact replied without being messaged in the window). Under a divider, "Conversation activity" shows inbound messages, responding contacts and replies per responding contact (one decimal, "-" when none); below it, "Compared with previous period" shows the contact reply rate (replied / messaged) with an arrow and the change in points (up good, down warning, zero neutral; hidden when the previous window messaged no contacts). The old message stages and end-to-end remain in the response (`funnel.stages`, `endToEnd`) for other readers but are no longer drawn. A fourth stage "Goal completed" is `blocked: no goal event` (the data model has no goal concept); the web keeps a clearly marked extension point (`funnelStages` in `lib/funnel-model.ts`).
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard funnel), resources/views/user/dashboard/index.blade.php
- **Port notes:** Share one funnel function with TW-DASH-025 (analytics) and pass `engineScope` explicitly; the Reference analytics page forgot the engine filter, do not copy that.

### TW-DASH-019 — Dashboard workspace activity log widget

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-NOTIF (audit log)
- **Summary:** The ten most recent customer-facing audit events for the workspace, with actor initials, action, subject and relative time, hiding authentication and session noise.
- **Actors & access:** As TW-DASH-001; "All" links to the activity log page (`user.activity-log.index`, NOTIF).
- **UX & screens:** Card "Activity log" (subtitle "Workspace events · auto-refresh", QUIRK: it does not refresh) with a vertical rail; each item: initials bubble, "actor · action — Subject" (tooltip with the same), and "{n} ago · subject_snake_case". Empty: "No recent activity logged for this workspace."
- **Endpoints:** part of `GET dashboard`.
- **Data:** `audit_logs` where `workspace_id = ws` and `action` does not start with `auth.`, `session.` or `user.`, ordered `created_at` desc, limit 10 (the controller comment says 6). Actor = `users.name` by `actor_user_id` (N+1 lookup) or "System". Subject shown is the basename of `subject_type`.
- **Rules & edge cases:**
  1. Excluding `user.%` also hides user-management actions (invites, role changes) that an admin might want to see.
  2. Relative time comes from Carbon's short-diff and is server-computed.
- **Async & events:** none. Audit rows are written by every domain through the audit helper.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 15 audit rows including 5 `auth.login`, Then the widget lists 10 non-auth rows newest first.
  - Given an audit row without an actor, Then it shows "System".
  - Given no rows, Then the empty text shows.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard events), resources/views/user/dashboard/index.blade.php
- **Port notes:** Read NOTIF's audit table via its service with an allow/deny action-prefix filter parameter; batch actor lookups.

### TW-DASH-020 — Dashboard quick actions and integrations health cards

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INTG, TW-ECOM
- **Summary:** A four-button quick-actions card (New broadcast, Build flow, New template, Auto-reply) and an integrations panel that claims to show which of four integrations are connected out of 12. Only part of the integration status is real.
- **Actors & access:** As TW-DASH-001.
- **UX & screens:** Quick actions: links `/broadcasts/create`, `/flows`, `/templates/create`, `/auto-reply`. Integrations: header "{connected} / 12", rows WooCommerce, Shopify, Google Sheets, Meta Catalog with a colored badge when connected or a "Connect" link to `/integrations`.
- **Endpoints:** part of `GET dashboard`.
- **Data:** WooCommerce connected = any `webhook_deliveries` row with `fired_at` inside the window, platform-wide (QUIRK: not workspace-scoped, and it is the outbound webhook table, so any tenant's webhook traffic marks every tenant as "WooCommerce connected"); detail "{n} events / 7d". Shopify: always "not connected" (hard-coded false). Google Sheets: `users.sheets_api_key` truthy (QUIRK: that attribute does not exist; the columns are `sheets_api_key_hash/suffix`, so it is never connected). Meta Catalog: the workspace's first `wa_provider_configs` row is connected ("WABA online"). Total 12 is a hard-coded constant.
- **Rules & edge cases:**
  1. The rebuild must source these from INTG/ECOM connection tables per workspace and count real installed integrations against the real catalog size.
  2. Status: partial (buttons work; panel is mostly placeholder logic).
- **Async & events:** none.
- **External systems:** none at render.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with a connected Shopify store, When the panel renders, Then Shopify shows connected (rebuild requirement; Reference always shows not connected).
  - Given another tenant fired webhooks, When workspace A views its dashboard, Then A's WooCommerce status is unaffected (rebuild requirement).
  - Given the user clicks "Connect", Then they land on the integrations page.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dashboard integrations), resources/views/user/dashboard/index.blade.php
- **Port notes:** Implement against a per-org `integrations` registry (INTG); do not port the placeholder logic.

### TW-DASH-021 — Dashboard throughput CSV export (client side)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-DASH-012
- **Summary:** The header Export button downloads a CSV of the daily throughput series already on the page.
- **Actors & access:** As TW-DASH-001. No server endpoint.
- **UX & screens:** Button `#dash-export`; builds `dashboard-throughput-YYYY-MM-DD.csv` in the browser with header `date,sent,delivered,failed` and every cell quoted, then toasts "Exported throughput CSV."
- **Endpoints:** none.
- **Data:** the legacy 8-day daily arrays (`labels` = weekday names, `sent`, `delivered`, `failed`) from `window.DASHBOARD_DATA`.
- **Rules & edge cases:**
  1. QUIRK: always exports the fixed 8-day weekday-labelled series, regardless of the selected range, and the "date" column holds weekday abbreviations, not dates.
  2. No formula-injection guard is needed because cells are only weekday labels and numbers.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the dashboard is loaded, When Export is clicked, Then a CSV with header `date,sent,delivered,failed` and one row per bucket downloads and a success toast appears.
  - Given range 30d is selected, When Export is clicked, Then (rebuild requirement) the file contains 30 daily rows with ISO dates.
- **Source refs:** resources/js/charts/user-dashboard-index.js, resources/views/user/dashboard/index.blade.php
- **Port notes:** Prefer a server CSV endpoint reusing TW-DASH-012's query and honoring the range; keep RFC 4180 quoting.

### TW-DASH-022 — Workspace analytics page: access, plan gate and date filter

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PLAN (feature flag), TW-RBAC, TW-DASH-002
- **Summary:** `/analytics` is the workspace messaging report. A filter bar chooses Last 7 days, Last 30 days (default), Last 90 days or a Custom From/To range; the whole page recomputes server-side for that window and compares to the previous window of the same length.
- **Actors & access:** Workspace role >= manager (agents/viewers redirected to `/team-inbox`). Plan flag `access_analytics` ("Analytics dashboard" / "Advanced analytics") is enforced by the soft plan gate: on a plan without it, a GET is NOT blocked; the page still renders and a paywall overlay (`planPaywall`, "Your plan doesn't include analytics dashboard") is shared to the view. Non-GET requests would be blocked with 403 JSON or a back-redirect, but this page has none. Platform admins bypass. QUIRK: because the plan gate is soft on GET, `/analytics/export` also returns data on plans without the feature. The rebuild should decide whether to hard-block (recommended: hard 402/403 for the API, paywall UI for the page). Nav key is "more" (the page lives under the More menu, docs say "More menu -> Analytics"); the `analytics.view` workspace permission exists in the role matrix (owner, admin, manager) but is not enforced on the route.
- **UX & screens:** `resources/views/user/analytics/index.blade.php` (page key `user-analytics-index`). Hero band with "Analytics · Workspace" eyebrow and "Live · last refresh HH:MM UTC±x" (the time is the render time in the workspace timezone; the word "Live" is decorative), headline "{deliverability}% of messages reached their reader this week." (QUIRK: always says "this week" even for 30d/90d/custom), and a sub-line "{n} messages · {recipients} unique recipients · {reply rate}% reply rate." or "No outgoing messages yet - once your first queue sends, this dashboard fills in." Buttons: "Export CSV". Filter bar (form GET `/analytics`): pills 7d / 30d / 90d / Custom set a hidden `range` field and submit immediately (Custom only highlights and reveals date inputs), From/To date inputs pre-filled with the effective dates, Apply submits.
- **Endpoints:**

| Method uri    | Route name     | Controller@action             | Middleware                                          | Request                                         | Response |
| ------------- | -------------- | ----------------------------- | --------------------------------------------------- | ----------------------------------------------- | -------- |
| GET analytics | user.analytics | UserPagesController@analytics | auth, workspace.role:manager, plan:access_analytics | `range`=7d/30d/90d/custom, `from`, `to` (Y-m-d) | HTML     |

- **Data:** see TW-DASH-023 to TW-DASH-031.
- **Rules & edge cases:**
  1. Window: 7d = start of day 7 days ago to end of today; 30d (default and fallback for any unknown value) = 30 days; 90d = 90 days; custom = From start of day to To end of day; a missing From falls back to 30 days ago, a missing To to end of today; unparseable input falls back to the 30-day start; From later than To is swapped automatically. `days = max(1, diffInDays(from,to) + 1)`.
  2. Previous window: `prevTo = from - 1 second`, `prevFrom = start of day (prevTo - (days - 1) days)`, i.e. exactly the same number of days.
  3. Numbers are scoped to the current workspace (TW-DASH-002) but the previous window omits the engine filter (QUIRK).
  4. The hero and KPI card titles say "all time" / "this week" although they show the selected window (QUIRK).
  5. Filter state lives only in the query string.
- **Async & events:** none. No realtime; a page reload is the refresh.
- **External systems:** none.
- **Settings:** plan feature `access_analytics`; workspace timezone (`heatmapTzLabel`).
- **Acceptance criteria:**
  - Given no `range`, When the page loads, Then the window is the last 30 days ending today and the "30d" pill is active.
  - Given `range=custom&from=2026-05-10&to=2026-05-01`, When the page loads, Then the window is 2026-05-01 to 2026-05-10 (swapped).
  - Given `range=custom` with an empty From and To, Then the window is the last 30 days.
  - Given the workspace plan lacks `access_analytics`, When a manager opens the page, Then the data renders behind a paywall overlay (Reference) / is denied (rebuild decision to record).
  - Given an agent, When they open `/analytics`, Then they are redirected to `/team-inbox`.
- **Source refs:** app/Http/Controllers/UserPagesController.php (analytics), routes/web.php (analytics routes), app/Http/Middleware/EnforcePlanFeature.php, config/plan_gates.php, resources/views/user/analytics/index.blade.php, resources/js/charts/user-analytics-index.js, Documentation/pages/growth/analytics.html
- **Port notes:** `apps/web/app/(app)/analytics`; API `GET /analytics/overview?from=&to=`; validate with Zod (`from <= to`, max span e.g. 366 days; Reference has no cap). Entitlement check via PLAN's guard.

### TW-DASH-023 — Analytics headline, hero KPI card and trend stat cards

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-DASH-022
- **Summary:** A dark hero card with total messages, delivered/failed, a sparkline of daily sends and recipients / replies / reply rate, next to six stat cards (Delivered, Recipients, Devices, Queued, Failed, Reply rate) with real up/down trend badges versus the previous window.
- **Actors & access:** As TW-DASH-022.
- **UX & screens:** Hero: "Total messages · all time" (QUIRK label), big number, "{delivered}% delivered" chip, "{delivered} delivered" / "{failed} failed" legend, `#hero-spark` area sparkline of the daily Sent series (green), and three minis recipients / replies in / reply rate. Stat cards: Delivered (count, "{x}% rate", trend ↑/↓ %), Recipients ("unique numbers", trend), Devices ("{online} / {total}", pill Healthy when all online and total > 0, Degraded when some online, Offline otherwise; sub-text "all online" / "{n} offline" / "no devices"), Queued ("in queue", trend where a rise is bad), Failed ("carrier errors", trend where a rise is bad), Reply rate ("conversation start", trend in pp). Trend pill colour: green good / coral bad; for Queued and Failed the polarity is inverted.
- **Endpoints:** part of `GET analytics`.
- **Data:** Out rows from both stores in the window, engine-scoped: total = Out count; delivered = delivered set; failed = status failed; queued = max(0, total - delivered - failed); repliesIn = In count. `uniqueRecipients` = number of `conversations` created in the window for the workspace (QUIRK: new conversations, not distinct recipients, and not engine-scoped). Deliverability = delivered/total*100; reply rate = In/total*100 (1 dp). Deltas = percent change versus the previous window for delivered, recipients, queued, failed; reply rate delta in pp. Devices online/total use the list from TW-DASH-026.
- **Rules & edge cases:**
  1. QUIRK: the previous-window queries (`prevMsgQ`, `prevImQ`) omit the engine filter, so a multi-engine or recently switched workspace shows misleading trends.
  2. All-zero windows show 0 everywhere and "no devices" if none.
  3. Delta for a metric with previous 0 and current > 0 = +100.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 1,000 Out messages, 900 delivered, 50 failed, Then Queued = 50, deliverability 90.0% and headline "90.0%".
  - Given previous failed = 100 and current = 50, Then the Failed card shows ↓ 50% in green (fewer failures is good).
  - Given 3 of 4 devices online, Then the Devices pill reads Degraded and sub-text "1 offline".
- **Source refs:** app/Http/Controllers/UserPagesController.php (analytics KPI block), resources/views/user/analytics/index.blade.php, resources/js/charts/user-analytics-index.js
- **Port notes:** Shared MetricsRepository (TW-DASH-002) returns `{current, previous}`; make previous use the same filters.

### TW-DASH-024 — Analytics volume trend, daily totals and delivery-rates charts

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-DASH-022
- **Summary:** Three charts of the window: a smooth area "Messages over time" (Sent / Delivered / Failed per day), a stacked bar "Daily totals" (Sent / Queued / Failed), and a donut "Delivery rates" (Delivered / Queued / Failed share).
- **Actors & access:** As TW-DASH-022.
- **UX & screens:** `#chart-volume` area (height 320, gradient fill, delivered line dashed, x tick amount 8, y 1000 -> "1k", tooltip "N msg"); `#chart-totals` stacked column (height 280, colors green / amber / coral, legend bottom); `#chart-rates` donut (size 68%, center label "events" with the total, labels formatted "x.x%"). Titles: "Volume trend / Messages over time", "Daily totals / Sent · queued · failed" with a "stacked" chip, "Quality / Delivery rates".
- **Endpoints:** part of `GET analytics`; data embedded as `window.ANALYTICS_DATA` (`labels`, `sent`, `delivered`, `failed`, `queued`, `types`, `devices`, `heatmap`).
- **Data:** one value per day from `from` for `days` days, labels `M d`. dailySent = Out rows per day with status in {delivered, read, sent, queued, pending} (QUIRK: excludes failed and any other status, so the chart's "Sent" is not the KPI's Total); dailyDelivered = {delivered, read, sent}; dailyFailed = {failed}; dailyQueued = max(0, sent - delivered - failed) per day (QUIRK: subtracts failed from a series that already excludes failed, so queued is understated). Per-day grouping is `DATE(created_at)` in the database (UTC) with keys formatted in app timezone. Donut percentages = each series total / (sentT + queuedT + failedT).
- **Rules & edge cases:**
  1. Windows longer than a few hundred days produce many points; the chart does not down-sample.
  2. Empty windows draw empty series.
  3. Colors come from theme tokens.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a 7-day window with sends on 3 days, Then all three charts show 7 x-axis points with zeros on empty days.
  - Given 10 Out messages on a day (6 delivered, 2 queued, 2 failed), Then that day's Sent series value is 8 (queued+delivered) in Reference; the rebuild must define Sent explicitly (recommend Sent = all Out, Queued = pending/queued) and document the change.
  - Given all messages delivered, Then the donut shows 100% Delivered.
- **Source refs:** app/Http/Controllers/UserPagesController.php (dailyCount, analytics), resources/js/charts/user-analytics-index.js, resources/views/user/analytics/index.blade.php
- **Port notes:** One SQL `group by date_trunc('day', created_at at time zone :tz), status` feeding all three series; pre-pivot on the server.

### TW-DASH-025 — Analytics engagement funnel with previous-period delta

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-DASH-022, TW-DASH-018
- **Summary:** The same four-stage funnel as the dashboard (Sent, Delivered, Replied, Engaged) for the selected window, plus an "end-to-end" percentage with a ▲/▼ percentage-point change against the previous window.
- **Actors & access:** As TW-DASH-022.
- **UX & screens:** Card "Conversion / Engagement funnel" with the range key chip; stage rows sized min 8%..100% of card width by share; "↓ x%" connectors; footer "end-to-end {pct}%" and "▲/▼ {pp}pp vs prev".
- **Endpoints:** part of `GET analytics`.
- **Data:** As TW-DASH-018 but engaged = distinct conversation ids with an In inbox message in the window, joined to workspace conversations WITHOUT the engine/provider filter (QUIRK: differs from the dashboard). Previous end-to-end = prevUniqueRepliers / prevTotal*100; delta = current end-to-end - previous, 1 dp.
- **Rules & edge cases:**
  1. Percentages > 100 are possible for stage 3.
  2. Zero previous sends give previous end-to-end 0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given end-to-end 20% now and 15% before, Then the footer shows "▲ 5pp vs prev".
  - Given no data, Then all stages show 0 and end-to-end 0%.
- **Redesign (intended change):** Analytics uses the same contact-based card as TW-DASH-018 (one shared component); `trends.replyRateContactPp` is the contact reply-rate change in points. The message-based end-to-end delta (`endToEndPp`) stays in the response but is not drawn. Goal completed: `blocked: no goal event`.
- **Source refs:** app/Http/Controllers/UserPagesController.php (analytics funnel), resources/views/user/analytics/index.blade.php
- **Port notes:** Reuse the dashboard funnel function with a `from/to` parameter and a shared engine filter.

### TW-DASH-026 — Analytics per-device send chart and device health

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WADEV, TW-WABA, TW-DASH-002
- **Summary:** A horizontal bar chart of messages sent per connected number in the window, with an "{online}/{total} online" badge; also feeds the Devices stat card.
- **Actors & access:** As TW-DASH-022.
- **UX & screens:** Card "Performance / By device": `#chart-devices` horizontal bar (labels "{device name} · +{cc} {first 4 digits}xx", data labels inside bars, tooltip "N msg"); empty text "No connected devices yet."
- **Endpoints:** part of `GET analytics`.
- **Data:** Up to 8 senders across enabled engines, default engine first: baileys `devices` (`forCurrentWorkspace`, ordered `active` desc, `id` desc), provider configs ordered `connected_at` desc mapped to device-like objects (name = display label or "{ENGINE} #id"). Per-device count = `Message` rows where `from_number = device.phone_number` in the window + `InboxMessage` rows likewise. Online = status `connected` and `active` (provider configs: `active` = status connected).
- **Rules & edge cases:**
  1. QUIRK (probable defect): `messages.from_number` and `inbox_messages.from_number` are encrypted-at-rest columns; an equality comparison against the plaintext phone number cannot match a randomly-encrypted value, so counts are expected to be 0 on installs that store encrypted numbers. The rebuild must join on `device_id`/`sender_id` instead. Verify with the parity skill before relying on it.
  2. Provider-config senders have no country code so labels omit the "+cc".
  3. Cap 8 devices; a workspace with more shows only the first 8.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 senders that sent 120, 40 and 5 messages in the window, Then the chart lists them in that order (rebuild requirement: sort by count desc) and the badge shows the online count over 3.
  - Given no senders, Then the empty message shows and the Devices card shows "no devices".
- **Source refs:** app/Http/Controllers/UserPagesController.php (analytics devices block), resources/js/charts/user-analytics-index.js, resources/views/user/analytics/index.blade.php
- **Port notes:** Aggregate by `sender_id` on the unified message table.

### TW-DASH-027 — Analytics message-type mix

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-DASH-022
- **Summary:** A donut of Out messages by type: Text, Template, Media, Interactive, Location.
- **Actors & access:** As TW-DASH-022.
- **UX & screens:** `#chart-types` donut (size 68%, labels "x.x%", colors purple / green / amber / coral / navy); card "Mix / Message types". When nothing was sent, the chart shows a single "Text" slice of 0.
- **Endpoints:** part of `GET analytics`.
- **Data:** every Out row of both stores in the window (engine-scoped) is loaded (`media_type`, `template_id`) and classified in PHP: `template_id` not null -> Template; `media_type` in image, video, audio, document -> Media; location -> Location; `contact` -> Interactive (QUIRK: contact cards are labelled Interactive; real interactive buttons/lists are not distinguished); everything else -> Text. Zero-count types are omitted.
- **Rules & edge cases:**
  1. Loads all rows into memory (rebuild: `group by`).
  2. `inbox_messages.template_id` is honored here, unlike the top-templates list.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 6 text, 3 template and 1 image Out messages, Then the donut shows Text 60%, Template 30%, Media 10%.
  - Given no Out messages, Then a single zero "Text" slice renders without error.
- **Source refs:** app/Http/Controllers/UserPagesController.php (typeBuckets), resources/js/charts/user-analytics-index.js
- **Port notes:** Add an explicit `message_type` column on the unified message table (text, template, image, video, audio, document, location, contact, interactive) so the rollup is a group-by; map to the five display buckets.

### TW-DASH-028 — Analytics top templates and top contacts lists

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-TPL, TW-TIB1
- **Summary:** Two ranked lists: "Top performers / Templates (top 8)" by sends, and "Most engaged / Top contacts" by message count in the window.
- **Actors & access:** As TW-DASH-022. The "Export" link in the contacts card points at the CSV export (TW-DASH-032).
- **UX & screens:** Templates: numbered rows with name, "{Category} · {LANG}", sends. Empty: "No template sends in this window." Contacts: initials bubble in one of five gradients, title, "{phone} · {last message relative}", "{n} msgs". Empty: "No conversations in this window."
- **Endpoints:** part of `GET analytics`.
- **Data:** Templates = the 8 most recently updated `wa_templates` of the workspace (`forCurrentWorkspace`), each with sends = Out rows in `messages` only (not inbox) with that `template_id` in the window (engine-scoped), then sorted by sends desc; QUIRK: templates with zero sends are still listed, and a heavily used but old template outside the latest 8 is missed. Contacts = scan the 20 most recent workspace conversations by `last_message_at`, keep those with at least one `inbox_messages` row in the window (count of both directions), stop at 5, sort by count desc (QUIRK: not a true ranking of all contacts). Title = conversation title or `+{raw_jid}`; phone = `raw_jid`.
- **Rules & edge cases:**
  1. N+1 per conversation and per template.
  2. Names are decrypted values; PII appears in the page.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 10 templates, Then at most 8 rows show, sorted by window sends.
  - Given 20 recent conversations of which 8 had traffic, Then 5 rows show, highest message count first.
  - Given no traffic, Then both empty texts show.
- **Source refs:** app/Http/Controllers/UserPagesController.php (topTemplates, topContacts in analytics), resources/views/user/analytics/index.blade.php
- **Port notes:** Implement real top-N with a group-by; keep the "top 8" and "top 5" limits.

### TW-DASH-029 — Analytics geography (device region) and event stream

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WADEV, TW-DASH-026
- **Summary:** A "By country" bar list built from device regions and a "Live event stream" of recent messages. Both are approximations that do not match their titles.
- **Actors & access:** As TW-DASH-022.
- **UX & screens:** Geo card "Reach / By country" with "{n} market(s)" chip; rows: region code (or "Unspecified" for missing), bar proportional to max, count; empty "No device regions yet." Event stream card ("Live", "Event stream") with a "Pause" button (no handler, QUIRK: does nothing), list of up to 6 rows "Sent -> {number}" / "Received from {number}", "{relative time} · msg · {status}"; empty "No recent activity in this window."
- **Endpoints:** part of `GET analytics`.
- **Data:** Geo: for each of the up-to-8 devices bucket by `strtoupper(region)` (or "-") and add the device's `sent_24h` counter (always 0 on real installs, see TW-DASH-014); top 7 by count. Stream: the 6 latest legacy `messages` rows in the window (not `inbox_messages`), title uses `to_number` for both directions (QUIRK: inbound rows show the workspace's own number).
- **Rules & edge cases:**
  1. The stream is static per page load.
  2. Numbers in the stream are decrypted PII.
  3. The docs call the geo panel "based on each number's region"; the dashboard's contact-country breakdown (`geoRows`) is computed on the dashboard controller but no longer rendered (dead computation, replaced by the flows card).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given devices in regions IN and US with non-zero counters, Then two rows show with proportional bars.
  - Given no devices, Then "No device regions yet." shows.
  - Given the stream has messages, Then each row shows direction, number, relative time and status.
- **Source refs:** app/Http/Controllers/UserPagesController.php (geoBuckets, events), resources/views/user/analytics/index.blade.php
- **Port notes:** For a real geography panel, group conversations/contacts by country derived from the phone number (CON `PhoneCountry`), not device region. Event stream should come from the realtime feed or the unified message table (both directions, correct counterpart number); wire Pause to actually pause updates or drop it.

### TW-DASH-030 — Analytics team performance table

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2 (assignment, first response, resolution), TW-TIB1
- **Summary:** A per-agent table of conversations handled, resolved count, average first-response time, average resolution time and CSAT for conversations created in the window and assigned to that agent.
- **Actors & access:** As TW-DASH-022. Section appears only if at least one conversation was assigned in the window. (The separate Team Inbox team analytics page is a TIB2 feature.)
- **UX & screens:** Card "Team performance / Agents in this window" with "{n} agents" chip and columns Agent (initials + name + email), Convos, Resolved, Avg 1st resp., Avg resolution, CSAT "{avg 2dp} ({count})" or "-". Times: under 60 minutes as "{m}m", else "{h}h {m}m" ("-" when null).
- **Endpoints:** part of `GET analytics`.
- **Data:** `conversations` of the workspace with `created_at` in the window and `assignee_user_id` not null; grouped by assignee. first response minutes = `created_at` -> `first_response_at` (only non-negative, only rows with the timestamp); resolution minutes = `created_at` -> `resolved_at` likewise; averages rounded to 1 dp; resolved = rows with `resolved_at`; CSAT = mean of `csat_responses.rating` (1-5, non-null) keyed by `conversation_id` (last response wins when several exist) rounded to 2 dp, with the count. Users loaded from `users` (id, name, email); sorted by convos desc.
- **Rules & edge cases:**
  1. Conversations are attributed to the CURRENT assignee, not whoever actually handled them (reassignment shifts credit).
  2. Business-hours awareness is absent: raw wall-clock minutes.
  3. Duration format: under 60 minutes shows as rounded minutes ("13m"), otherwise floor(hours) plus the rounded minutes modulo 60 ("2h 5m"); null shows "-".
  4. Not gated by the plan flag `access_team_performance` on this page (that flag gates the separate TIB2 pages).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given agent A with 4 conversations created in the window (2 resolved, first responses 5, 10, 15, 20 min), Then A's row shows Convos 4, Resolved 2, Avg 1st resp. "13m" (12.5 rounds up) and resolution over the two resolved ones.
  - Given two CSAT ratings 4 and 5, Then CSAT shows "4.50 (2)".
  - Given no assigned conversations in the window, Then the whole section is hidden.
- **Source refs:** app/Http/Controllers/UserPagesController.php (teamPerformance), resources/views/user/analytics/index.blade.php, app/Models/CsatResponse.php
- **Port notes:** Aggregate in SQL (`avg(extract(epoch from ...))`); source timestamps from TIB2's SLA fields; share the implementation with TIB2's team analytics page.

### TW-DASH-031 — Analytics best-hours heatmap (hour x weekday)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-DASH-022
- **Summary:** A weekday (Sun..Sat) by hour (00..23) heatmap of message volume in the workspace timezone, labelled with the real UTC offset.
- **Actors & access:** As TW-DASH-022.
- **UX & screens:** Card "Best hours / When your audience is awake" with subtitle "Read rate by hour x day - darker = higher engagement" (QUIRK: the values are message counts, not read rates), zone badge (e.g. "UTC+5:30"), `#chart-heatmap` (ApexCharts heatmap height 320, fixed colour ranges: 0 "none", 1-5 "low", 6-20 "med", 21-50 "high", 51+ "peak", tooltip "N messages"). Footer: "Computed from {total} events · {from} - {to} · timezone {label}". Empty state "No message volume in this window."
- **Endpoints:** part of `GET analytics`.
- **Data:** `inbox_messages` joined to workspace conversations in the window, BOTH directions and all statuses (no engine filter), grouped by weekday (`DAYOFWEEK - 1`) and hour after shifting `created_at` by the offset between the workspace timezone (`wa_tz()`) and the app timezone, applied inside SQL so day boundaries move too. Offset label: "UTC" when 0 else "UTC+h" or "UTC+h:mm" (half-hour zones keep their minutes). `legacy messages` are not included.
- **Rules & edge cases:**
  1. The offset is the CURRENT offset, so windows crossing a DST change are off by one hour for part of the range.
  2. Colour buckets are absolute counts, not relative, so tiny workspaces never see "peak".
  3. Timezone resolution order (`wa_tz`): explicit arg, workspace timezone, user timezone, platform `default_timezone`, `app.timezone`, UTC.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace `timezone`; platform `default_timezone`.
- **Acceptance criteria:**
  - Given a workspace in Asia/Jakarta and a message stored at 02:00 UTC Monday, Then it is counted in Monday 09:00.
  - Given a workspace in India, Then the badge reads "UTC+5:30".
  - Given no messages, Then the empty state shows.
- **Source refs:** app/Http/Controllers/UserPagesController.php (buildHeatmap, utcOffsetLabel), app/Support/fc_helpers.php (wa_tz), resources/js/charts/user-analytics-index.js
- **Port notes:** Use Postgres `extract(dow from created_at at time zone :tz)` and `extract(hour ...)` (DST-correct per row); relabel as "Message volume" or compute a real read-rate variant; make bucket colour scale relative to the max.

### TW-DASH-032 — Analytics CSV export

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-DASH-022
- **Summary:** Downloads a small CSV of headline counts for the same range filter: outbound messages, campaigns, broadcasts and contacts added.
- **Actors & access:** As TW-DASH-022 (same middleware, so also soft-gated by plan).
- **UX & screens:** "Export CSV" button in the hero and "Export" link in the top-contacts card; both carry the current `range`, `from`, `to`.
- **Endpoints:**

| Method uri           | Route name            | Controller@action                   | Middleware                                          | Request               | Response                       |
| -------------------- | --------------------- | ----------------------------------- | --------------------------------------------------- | --------------------- | ------------------------------ |
| GET analytics/export | user.analytics.export | UserPagesController@analyticsExport | auth, workspace.role:manager, plan:access_analytics | `range`, `from`, `to` | streamed `text/csv` attachment |

- **Data:** rows `Metric,Value`: Range ("YYYY-MM-DD to YYYY-MM-DD"), Outbound messages = count of `messages` rows (all directions, all engines, NOT only outbound despite the label), Campaigns = count of `wpcampaigns`, Broadcasts = count of `broadcasts`, Contacts added = count of `contacts`, each within `created_at` in the window. Workspace filter: if the table has `workspace_id` use the fallback rule, else if it has `user_id` use the workspace's user ids, else unfiltered; tables that do not exist return 0.
- **Rules & edge cases:**
  1. Filename = slug of "{app_name} analytics {from} {to}" + `.csv` (`app_name` system setting, default Reference).
  2. Range parsing differs slightly from the page: default 30d; `7d`, `90d`; `custom` honours `from`/`to` (swapped if inverted, silently keeps defaults on parse failure).
  3. CSV formula-injection guard: any cell starting with `=`, `+`, `-` or `@` is prefixed with an apostrophe.
  4. QUIRK: the export does not include delivered/failed/queued, funnel, per-day series or team table although docs say it "covers exactly the date range and workspace shown". The rebuild should export the KPI grid and the daily series at minimum.
- **Async & events:** none (streamed synchronously).
- **External systems:** none.
- **Settings:** `app_name` system setting.
- **Acceptance criteria:**
  - Given a manager, When they click Export CSV with `range=7d`, Then a file named like `threadwise-analytics-<from>-<to>.csv` downloads with the five rows above.
  - Given a cell value starting with "=", Then it is written with a leading apostrophe.
  - Given an agent, Then the request is redirected to `/team-inbox`.
- **Source refs:** app/Http/Controllers/UserPagesController.php (analyticsExport), routes/web.php
- **Port notes:** `GET /analytics/export.csv` streaming with a cursor; put csv-injection escaping in a shared util.

### TW-DASH-033 — Scheduled analytics report ("Schedule report") and Meta Ads summary on analytics

- **Status:** docs-only
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-DASH-022, TW-SCHED
- **Summary:** Docs advertise a "Schedule report" button next to Export CSV and a small ad spend/revenue summary on the analytics page. The button does not exist in the view, no route, model or command implements report scheduling, and the Meta Ads roll-up computed by the controller is never rendered.
- **Actors & access:** none (no working path).
- **UX & screens:** None. Docs (growth/analytics) list "Export CSV and Schedule report". The controller computes `metaTotalSpend`, `metaTotalRevenue`, `metaActive` from `meta_campaigns.insights` (`spend`, `revenue`) and passes them to the view, which ignores them.
- **Endpoints:** none.
- **Data:** would need a `scheduled_reports` concept (owner, cron/frequency, recipients, filter) that does not exist.
- **Rules & edge cases:**
  1. The roll-up reads `meta_campaigns` (filtered by `workspace_id` when the column exists and a workspace is set) and sums `insights.spend` / `insights.revenue` and counts status `ACTIVE`; it is dead computation on this page (MADS owns the real analytics).
  2. Marked for the port backlog only; do not build unless the product owner asks.
- **Async & events:** would need a schedule (`schedule.txt` is empty in Reference: no scheduled tasks exist).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the analytics page, When rendered in the rebuild, Then no dead "Schedule report" control is shown unless the feature is built.
  - Given the feature is later built, When a manager schedules a weekly report, Then a job emails a CSV to the chosen recipients (requires a new spec).
- **Source refs:** Documentation/pages/growth/analytics.html, app/Http/Controllers/UserPagesController.php (metaCampaignsQ), resources/views/user/analytics/index.blade.php
- **Port notes:** Backlog only. If built, use a BullMQ repeatable job per org report.

### TW-DASH-034 — Admin overview page and time-window picker

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-ASHELL (admin layout), TW-RBAC (platform admin), TW-DASH-035 to TW-DASH-040
- **Summary:** `/admin` is the platform owner's home dashboard. A dropdown chooses Last 24 hours, 7 days (default), 30 days, 90 days or Last year, reloads the page with `?window=` and every card, chart and delta is recomputed against the previous equal-length window.
- **Actors & access:** Platform admins only: `Authenticate` + `EnsureUserIsAdmin` (403 "Admins only." otherwise) + `IPAllowlist` (when `security.ip_allowlist_enabled`, requests from IPs outside `security.ip_allowlist_cidrs` get a 403 IP-blocked view and an `admin.access.blocked_by_ip` audit row; an enabled but empty allowlist fails open). Login of a platform admin redirects to `/admin` (TW-DASH-001). Cross-tenant by design: no workspace scoping.
- **UX & screens:** `resources/views/admin/dashboard/index.blade.php` (admin layout, key `overview`, page key `admin-overview`). Sticky top bar with breadcrumb "Admin > Overview" and a search input with a "⌘K" hint (decorative on this page; QUIRK: not wired here, global search is ASHELL). Heading "Admin dashboard." with subtitle, the window `<select name=window>` (auto-submits), and an "Add workspace" button to `admin.workspaces.create`. Sections in order: KPI row, revenue chart + country list, three secondary charts, workspace activity table + alerts.
- **Endpoints:**

| Method uri | Route name      | Controller@action              | Middleware                | Request                    | Response |
| ---------- | --------------- | ------------------------------ | ------------------------- | -------------------------- | -------- |
| GET admin  | admin.dashboard | Admin\OverviewController@index | auth, admin, ip-allowlist | `window`=24h/7d/30d/90d/1y | HTML     |

- **Data:** see TW-DASH-035 to TW-DASH-040. Currency symbol from `FormatSettings::symbol()`.
- **Rules & edge cases:**
  1. Window math: `to = end of today`; days = 1 (24h), 7 (default and any unknown value), 30, 90, 365; `from = start of day (to - days)`; `prevTo = from - 1 second`; `prevFrom = start of day (prevTo - days)`. QUIRK: "24h" is really yesterday + today (about 2 days); 7d is 8 calendar days. The picker shows no selected option when the URL carries an unknown value.
  2. The chosen window lives in the URL (bookmarkable).
  3. `AdminPagesController@dashboard` (an empty view stub) is dead code; `OverviewController` is the only route target.
  4. Everything is live; no caching; queries are unindexed aggregates over orders/users/messages.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin `default_currency` (symbol), `security.ip_allowlist_enabled`, `security.ip_allowlist_cidrs`.
- **Acceptance criteria:**
  - Given a signed-in non-admin, When they open `/admin`, Then they receive 403.
  - Given the IP allowlist is enabled with CIDR 10.0.0.0/8 and the request comes from 203.0.113.5, Then the response is 403 IP-blocked and an audit row is written.
  - Given `?window=30d`, Then all KPI values, deltas and charts use the 30-day window and the dropdown shows "Last 30 days".
  - Given no `window`, Then the 7-day window is used.
- **Source refs:** app/Http/Controllers/Admin/OverviewController.php, routes/admin.php, app/Http/Middleware/EnsureUserIsAdmin.php, app/Http/Middleware/IPAllowlist.php, resources/views/admin/dashboard/index.blade.php, resources/js/charts/admin-overview.js, app/Http/Controllers/AdminPagesController.php (dead dashboard stub), Documentation/pages/admin-panel/dashboard.html
- **Port notes:** `apps/api/src/modules/admin/overview` behind the platform-admin guard (`platform.*` permission keys from RBAC; there is no dedicated dashboard permission key in Reference, so define `platform.overview.view`). Runs with the RLS-bypassing platform role and must write an audit row per access if RBAC requires it. Snap windows to exact rolling spans.

### TW-DASH-035 — Admin overview KPI cards (income, profit estimate, views, conversion)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-DASH-034, TW-PLAN/TW-PAYGW (orders)
- **Summary:** Four headline cards with a value and a percentage delta versus the previous window.
- **Actors & access:** As TW-DASH-034.
- **UX & screens:** Cards "Total income", "Profit", "Total views", "Conversion rate". Each: value display, pill "+x.xx%" (green) / "-x.xx%" (coral) and "vs previous period".
- **Endpoints:** part of `GET admin`.
- **Data:** Total income = sum of paid revenue (orders with `status='paid'`, `paid_at` in window, `COALESCE(total_amount, amount)`), shown with currency symbol and 2 decimals. Profit = income * 0.32 rounded to 2 dp (hard-coded placeholder margin; docs warn it is not an accounting figure). Total views = Out messages platform-wide in the window (Eloquent `Message` + `InboxMessage`, excludes soft-deleted), integer. Conversion = distinct `workspace_id` with a paid order in the window divided by users created in the window * 100 (2 dp; 0 when no signups), shown with "%". Deltas: `prev > 0 ? round((now-prev)/prev*100, 2) : (now > 0 ? 100 : 0)`; positive = delta >= 0.
- **Rules & edge cases:**
  1. QUIRK: revenue sums `total_amount` across orders of different currencies with no conversion (orders carry `currency`, `base_amount_usd`, `exchange_rate` that are ignored) and displays it in the admin's symbol. The rebuild should sum a normalised base amount.
  2. QUIRK: conversion numerator counts any paying workspace (including renewals from old workspaces), denominator counts new users, so it can exceed 100% and does not measure signup-to-paid conversion.
  3. Profit is 32% of income; keep as a labelled estimate or replace with real cost data (decide with the product owner).
  4. "Views" is a misnomer for messages sent.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin `default_currency`.
- **Acceptance criteria:**
  - Given paid orders totalling 1,000 in the window and 800 in the previous window, Then Total income shows 1,000.00 with +25.00%.
  - Given income 1,000, Then Profit shows 320.00.
  - Given 10 signups in the window and 2 workspaces paid, Then Conversion shows 20.00%.
  - Given no previous-window data and current > 0, Then the delta shows +100.00%.
- **Source refs:** app/Http/Controllers/Admin/OverviewController.php (kpis, card, paidRevenue, messagesSent), resources/views/admin/dashboard/index.blade.php, app/Models/Order.php
- **Port notes:** Use one `PlatformMetrics` service shared by overview, financial and analytics so revenue is defined once (Reference has three inconsistent revenue definitions; see quirks). Store order `paid_at`, `total_minor`, `currency`, `base_amount_minor`.

### TW-DASH-036 — Admin overview revenue-over-time chart with target line

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-DASH-034
- **Summary:** A smooth line chart of paid revenue in up to 12 time buckets across the window, with a "target" line and the totals in the card header.
- **Actors & access:** As TW-DASH-034.
- **UX & screens:** Card "Revenue over time": legend "Total revenue {sum}" (deep green) and "Total target {sum}" (amber); `#admin-revenue-chart` ApexCharts line (height 275, smooth, width 3, no markers, legend hidden, y-axis "{WA_CURRENCY}{localised number}", theme tokens for colours and grid).
- **Endpoints:** part of `GET admin` (payload `window.adminOverview.revenue`: `labels`, `series`, `target`, `total`, `totalTarget`).
- **Data:** bucket size `step = max(1, floor(daysBetween(from, to) / 12))` days; up to 12 buckets starting at `from`, each `[start, start + step days - 1s]`, last one capped at `to`, loop stops once the cursor passes `to`. Each bucket = paid revenue in that range. Label = "M j" when step < 28 else "M Y". Target for bucket i = `max(100, round(previous bucket revenue * 1.1, 2))` (first bucket: `revenue * 0.9 * 1.1`). Totals = sum of series / sum of targets with currency symbol, 2 dp.
- **Rules & edge cases:**
  1. QUIRK: for 30d/90d/1y the fixed 12 buckets do not reach the end of the window (30d covers the first 24 days, 90d the first 84, 1y the first 360), so the newest revenue is omitted and "Total revenue" is lower than the KPI income. 7d gives 8 daily buckets; 24h gives 2.
  2. The target is a synthetic 10% growth benchmark, not a stored goal.
  3. Empty payload renders an empty chart.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `window=7d`, Then the chart has one point per day (8 points).
  - Given revenue [100, 200] in consecutive buckets, Then the targets are [100, 110] (bucket 1: 100 x 0.9 x 1.1 = 99 raised to the floor of 100; bucket 2: 100 x 1.1 = 110) and no target is ever below 100.
  - Given no revenue, Then all series are 0 and targets are 100.
  - Given the rebuild, When the window is 30d, Then the buckets cover the whole window (deliberate fix) and the header total equals the KPI income.
- **Source refs:** app/Http/Controllers/Admin/OverviewController.php (revenueSeries), resources/js/charts/admin-overview.js, resources/views/admin/dashboard/index.blade.php
- **Port notes:** `date_bin`/`generate_series` over the exact window in the platform display timezone; keep the target as an explicitly labelled projection or make it configurable.

### TW-DASH-037 — Admin overview geography panels (sessions by country, sales by region)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-AUTH (signup country), TW-DASH-034
- **Summary:** A "Session by country" list (top 4 countries by signups in the window) and a radar "Sales by region" chart (signups rolled up into six regions). Both are signup-based approximations mislabelled as sessions/sales.
- **Actors & access:** As TW-DASH-034.
- **UX & screens:** Country card: rows with a coloured 2-letter badge, name, "{count} · {pct}%" and a bar scaled to the largest share; empty text "No country data yet - users haven't shared their region." Region card: `#admin-region-chart` radar (height 245, 6 axes: Europe, Americas, Africa, Middle East, Pacific, Asia; markers 3; fill 16%).
- **Endpoints:** part of `GET admin`.
- **Data:** `users.country_code` (varchar 8) grouped for users created in the window (soft-deleted excluded), top 4 by count; percent = count / sum of the top-4 counts (1 dp); name from a 10-entry ISO map (AU, ID, TH, DE, IN, US, GB, BR, PH, JP) else the uppercased code. Regions bucket ISO codes from fixed lists (Europe: GB DE FR IT ES NL SE NO PL RU CH; Americas: US CA MX BR AR CL CO; Africa: ZA NG KE EG MA GH; Middle East: AE SA IL TR IR QA KW; Pacific: AU NZ FJ; Asia: IN CN JP KR ID TH VN MY PH SG BD PK LK) and sum signups per region. Returns empty/zeros if the column is missing.
- **Rules & edge cases:**
  1. QUIRK (likely defect): `users.country_code` is captured as the phone DIAL prefix (e.g. "91", "44") by the signup/OTP and profile forms, not an ISO alpha-2 code, so the country list would show numbers and the region radar stays all zero. The workspace dashboard translates dial codes to ISO (TW-DASH-029); the admin page does not. Docs also claim the platform stores no country at all, so they present the panels as "illustrative".
  2. Percent is relative to the top-4 sum, not to all signups.
  3. Titles say "Session" / "Sales" but the metric is new-user count.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given signups from IN (5), US (3), DE (1), GB (1) in the window, Then the list shows India 50.0%, United States 30.0%, Germany 10.0%, United Kingdom 10.0% (if country is stored as ISO).
  - Given no signups with a country, Then the empty text shows and the radar renders six zeros.
  - Given a rebuild that stores ISO country, Then the region radar sums signups per region.
- **Source refs:** app/Http/Controllers/Admin/OverviewController.php (sessionsByCountry, salesByRegion, countryName), resources/js/charts/admin-overview.js, resources/views/admin/dashboard/index.blade.php, Documentation/pages/admin-panel/dashboard.html
- **Port notes:** Store `country` (ISO 3166-1 alpha-2) and dial code separately on the user/org profile; compute regions with a lookup table (shared with TW-DASH-029's phone-country mapping).

### TW-DASH-038 — Admin overview sales-by-platform donut and registered-users radial

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-PAYGW, TW-PLAN, TW-DASH-034
- **Summary:** A donut of paid revenue for the top three payment gateways and a radial gauge showing the share of users who own a paid-plan workspace, with premium / basic counts.
- **Actors & access:** As TW-DASH-034.
- **UX & screens:** "Sales by platform / E-commerce integrations" (`#admin-platform-chart` donut, height 245, no data labels, legend bottom; subtitle is a misnomer, the split is by payment gateway). "Registered users / Overview of user seats": `#admin-users-chart` radialBar (hollow 62%, centre label "Total users" and the total count) plus two counters "Premium plan" and "Basic plan".
- **Endpoints:** part of `GET admin`.
- **Data:** Gateways: `orders` paid in window with non-null `gateway_slug`, `SUM(paid revenue)` per slug, top 3 by revenue, label = ucfirst(slug), values 2 dp; when none, placeholder labels Stripe / Razorpay / PayPal with zeros. Users: total = `users` count (all users including admins; soft-deleted excluded); premium = number of distinct workspace owners (`workspaces.owner_user_id`) whose workspace `plan` value is in the ids of packages with `free = false`; basic = max(0, total - premium); percent = round(premium/total*100).
- **Rules & edge cases:**
  1. QUIRK: `workspaces.plan` is a varchar that can hold the plan slug (`plan_id`, e.g. "starter", the default) or the numeric package id (the Workspace model resolves both); the WHERE IN uses package ids, so workspaces storing slugs are never counted as premium. Rebuild must reference plans by a stable foreign key.
  2. Basic includes admins and free/trial owners.
  3. Only the top 3 gateways show; the rest are dropped rather than grouped as "Other".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given paid revenue Stripe 800, Razorpay 150, PayPal 50, Cashfree 10, Then the donut shows Stripe, Razorpay, PayPal.
  - Given 100 users of which 25 own a paid-plan workspace, Then the gauge reads 25%, Premium 25, Basic 75, centre "100".
  - Given no paid orders, Then the donut shows the three placeholder gateways at 0.
- **Source refs:** app/Http/Controllers/Admin/OverviewController.php (salesByPlatform, planUserBreakdown), resources/js/charts/admin-overview.js
- **Port notes:** Add an "Other" slice; count premium via subscription state, not the plan string.

### TW-DASH-039 — Admin overview workspace activity table

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WSP, TW-PLAN
- **Summary:** A table of the five most recently active workspaces with owner, plan pill, last-7-day message volume, a health label and MRR; rows open the workspace detail page.
- **Actors & access:** As TW-DASH-034.
- **UX & screens:** Card "Workspace activity / Recent high-value admin events" with "View all" to `admin.workspaces.index`. Columns Workspace (name + industry or "-"), Owner (or "-"), Plan pill, Messages ("1.2k"/"3m" humanised), Health, MRR ({symbol}{amount, 0 dp}). Row click goes to `admin.workspaces.detail`. Empty: "No workspaces yet."
- **Endpoints:** part of `GET admin`.
- **Data:** `workspaces` (soft-deleted excluded) ordered by `last_active_at` desc, limit 5, with owner. Plan = package resolved by `workspaces.plan` used as a package id (QUIRK: slug-valued plans resolve to nothing, so the pill shows "Free" and MRR 0). MRR = `Package::chargeableAmount()` (0 if free or amount <= 0; `offer_price` when set and > 0, else `plan_amount`), NOT divided by billing period. Messages = Out rows in the legacy `messages` table in the last 7 days for that workspace (inbox messages ignored). Health: >= 500 "Good" (green), >= 50 "Active" (green), > 0 "Low" (amber), else "Idle" (grey). Plan pill colours by name substring: enterprise (blue), pro (purple), growth/standard (green), starter/basic (amber), else grey. Humanise: >= 1,000,000 "x.ym", >= 1,000 "x.yk".
- **Rules & edge cases:**
  1. Code comment says "Top 5 workspaces by MRR" but ordering is by recent activity.
  2. Docs describe Good/Watch/Risk with 50,000/5,000 thresholds; the code uses the 500/50 scale above (docs are stale).
  3. Workspaces with NULL `last_active_at` sort last.
  4. N+1 message count per row.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 7 workspaces, Then only the 5 with the latest `last_active_at` show.
  - Given a workspace with 120 outbound messages in 7 days, Then Health = "Active"; with 0, "Idle".
  - Given a row is clicked, Then the browser opens that workspace's admin detail page.
- **Source refs:** app/Http/Controllers/Admin/OverviewController.php (workspaceActivity, planTone, humanize), resources/views/admin/dashboard/index.blade.php
- **Port notes:** Count from the unified message table; compute monthly-normalised MRR from the subscription (billing_cycle); `last_active_at` must be maintained by WSP.

### TW-DASH-040 — Admin overview alerts panel

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-PAYGW (failed orders), TW-WSP
- **Summary:** A priority queue of up to three operational alerts: recent payment failures, an hourly message spike on one workspace, and a count of workspaces awaiting approval.
- **Actors & access:** As TW-DASH-034.
- **UX & screens:** Card "Admin alerts / Priority queue" with a "{n} open" pill; items with severity styling (high = coral border/background, others plain), title and detail; empty text "All systems healthy - no alerts."
- **Endpoints:** part of `GET admin`.
- **Data:** (1) High: up to 2 latest orders with `status='failed'` created in the last 24h; title "{workspace name or 'Workspace #id'} payment failed", detail = `failure_reason` or "Gateway returned failed status" + ".". (2) Medium: from `messages` (raw table, includes soft-deleted) take the single workspace with the most Out rows in the last hour; if its 7-day hourly average (7-day Out count / 168) is > 0 and last-hour count >= 3x average, alert "{name} message spike" with "{ratio}x normal hourly volume." (ratio 1 dp). (3) Low: count of workspaces with `status = false` (pending approval); title "{n} workspace review(s) pending", detail "Newest signup awaiting admin approval." Only the first three alerts are shown; the header counts all generated alerts before truncation (QUIRK: can read 4 open while 3 show).
- **Rules & edge cases:**
  1. Only the top spike workspace is evaluated; a spike on the second-busiest workspace is missed.
  2. A brand-new workspace with no 7-day history (average 0) never triggers.
  3. Alerts are not persisted, acknowledged or dismissible; they are recomputed each load.
  4. Uses the legacy `messages` table only (not inbox messages).
- **Async & events:** none (no notification is sent; NOTIF may add push/email alerts later).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 failed orders in the last 24h, Then only the 2 newest appear as high alerts.
  - Given a workspace with 40 sends in the last hour and an average of 5 per hour, Then a medium alert "Workspace X message spike" with "8.0x normal hourly volume." appears.
  - Given 2 workspaces with status pending, Then "2 workspace reviews pending" appears.
  - Given none of these conditions, Then "All systems healthy - no alerts." shows and the pill reads "0 open".
- **Source refs:** app/Http/Controllers/Admin/OverviewController.php (alerts), resources/views/admin/dashboard/index.blade.php, Documentation/pages/admin-panel/dashboard.html
- **Port notes:** Model alerts as a computed list now; a persistent `platform_alerts` table with ack/dismiss is a possible improvement (out of parity scope).

### TW-DASH-041 — Admin analytics page shell, days filter and section tabs

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-ASHELL, TW-DASH-034
- **Summary:** `/admin/analytics` is a tabbed control-room report (Overview, Revenue, Usage, Workspaces, Campaigns, Support) with a days selector (7 / 30 / 90 / 365) and an Export button. Tabs only show or hide server-rendered panels.
- **Actors & access:** Platform admins (same three middleware as TW-DASH-034).
- **UX & screens:** `resources/views/admin/analytics/index.blade.php` (key `analytics`, page key `admin-analytics-index`). Heading "Admin analytics." Days `<select>` navigates to `?days=N` (options Last 7 / 30 / 90 days / "This year" = 365). Tab bar `[data-wa-tabs]` with pill buttons; a static "refreshed just now" chip (never updates, QUIRK). JS (`admin-analytics-index.js`) switches panels by `data-wa-tab-panel` space-separated keys, then re-fires chart resize because ApexCharts will not draw into hidden containers; default tab "overview". Panel-to-tab map: KPI strip = overview; growth+pulse = overview/revenue/usage/workspaces; plan mix + acquisition + devices = overview/usage/campaigns; leaderboard + cohort = overview/workspaces; revenue composition + support load + action queue = overview/revenue/support. QUIRK: the Campaigns tab shows only the same plan/acquisition/device panels and no campaign or delivery metrics, although the subtitle promises "campaign delivery".
- **Endpoints:**

| Method uri          | Route name      | Controller@action              | Middleware                | Request                    | Response    |
| ------------------- | --------------- | ------------------------------ | ------------------------- | -------------------------- | ----------- |
| GET admin/analytics | admin.analytics | AdminPagesController@analytics | auth, admin, ip-allowlist | `days` (int), `export=csv` | HTML or CSV |

- **Data:** see TW-DASH-042 and TW-DASH-043.
- **Rules & edge cases:**
  1. `days = clamp((int) days, 1, 365)` with default 30; `since = now() - days days` (a rolling instant, not start of day). Non-standard values typed in the URL work but the select shows none selected.
  2. The header search box is decorative.
  3. No previous-period comparison on this page.
  4. Several small aggregates run inside the Blade view (`support_tickets` grouping) with try/catch; the rebuild should compute all in the API.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `?days=90`, Then every "last N days" label reads 90 and the select shows "Last 90 days".
  - Given `?days=5000`, Then it is clamped to 365.
  - Given the user clicks the "Revenue" tab, Then only panels tagged revenue remain visible and charts redraw at the right width.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (analytics), resources/views/admin/analytics/index.blade.php, resources/js/charts/admin-analytics-index.js
- **Port notes:** Implement tabs client-side over one payload (`GET /admin/analytics?days=`); consider lazy-loading per tab. Add real campaign metrics or drop the tab.

### TW-DASH-042 — Admin analytics KPI strip and "Platform pulse"

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-DASH-041
- **Summary:** Six platform KPIs and a four-bar "Platform pulse" card summarising workspaces, devices, tickets and signups.
- **Actors & access:** As TW-DASH-041.
- **UX & screens:** KPI cards: Revenue (window, formatted money or "-"; sub "{n} new workspaces"), Workspaces (total; sub "{users} total users"; pill "+{new}"), Messages (count or "-"; sub "{avg} / day avg" when non-null), Devices online ("{online}/{total}" with percent pill), New users (window count; sub total), Open tickets (coral border and "watch" when > 0 else "clear"). Pulse card: Workspaces online (bar = min(100, total workspaces)%), Devices connected (%), Open tickets (bar = min(100, tickets*5)%), New signups (bar = min(100, new users)%); a static "normal" badge.
- **Endpoints:** part of `GET admin/analytics`.
- **Data:** users total / new (`created_at >= since`), workspaces total / new, devices: Baileys `devices` with status `connected` AND `active` (online) over all devices (WABA/Twilio not included), `messages_outbound` count since `since` (QUIRK: this table does not exist in the schema, the query throws and is caught, so Messages is always "-"), revenue = `SUM(orders.total_amount)` of paid orders with `created_at >= since` (raw table; not `paid_at`; not COALESCE; includes soft-deleted workspaces), tickets open = `support_tickets` with status in open, in_progress, pending (0 on failure).
- **Rules & edge cases:**
  1. "Workspaces online" is total workspaces, not online ones (label misnomer).
  2. Bars use arbitrary saturation scales (100 workspaces = full).
  3. Three different revenue definitions exist across admin pages (this: created_at + total_amount; overview and financial: paid_at + COALESCE).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 12 users of which 3 created in the window, Then "New users" shows 3 and "12 total".
  - Given 8 devices of which 6 connected and active, Then Devices online shows "6/8" and 75%.
  - Given 2 open tickets, Then the Open tickets card is highlighted with "watch".
  - Given the rebuild, Then Messages shows the real outbound count for the window (fixing the missing-table defect).
- **Source refs:** app/Http/Controllers/AdminPagesController.php (analytics kpi block), resources/views/admin/analytics/index.blade.php
- **Port notes:** Use the shared PlatformMetrics service (TW-DASH-035); include all engines in devices online.

### TW-DASH-043 — Admin analytics charts, leaderboard and action queue

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-DASH-041
- **Summary:** The chart and list panels of the admin analytics page: signups area chart, workspaces-by-plan donut, users-to-workspace acquisition bars, top devices bar chart, top-workspaces leaderboard, daily signup bars, revenue composition, support ticket state bars and an action queue.
- **Actors & access:** As TW-DASH-041.
- **UX & screens:** (a) "Growth command center / User signups, last N days": `#chart-platform-growth` area (height 315, smooth, gradient). (b) "Plan distribution / Workspaces by plan": donut (`#chart-module-mix`, 8-colour palette) + first five plans with share %, empty state "No data yet - plan distribution shows once at least one workspace has been assigned a plan". (c) "Acquisition / Users -> Workspace": five bars (total users, new users with % of total, workspaces created, new workspaces with % of new users, devices connected) and two counters. (d) "Top devices · 24h / Send volume": horizontal bar `#chart-delivery` (series "Sends (24h)") with counters devices / online / 24h sends; empty state "No sends yet". (e) Leaderboard table "Top workspaces by paid revenue · last N days" (workspace, orders, paid revenue, "Open ->" to the workspace detail; empty "No paid orders in this window."). (f) "Signup cohorts / Recent N days": `#chart-retention` column chart of daily signups. (g) "Revenue composition / Top contributors": top-5 workspace share bars. (h) "Support load / Tickets state": bars per ticket status plus open / resolved / inbox link; empty "No tickets yet.". (i) "Admin attention / Action queue": conditional cards (open tickets -> `/admin/support`, devices offline when fewer than half online -> `/admin/workspaces`, new users -> `/admin/users`, else "All clear").
- **Endpoints:** part of `GET admin/analytics`.
- **Data:** signups = users grouped by `DATE(created_at)` since `since` (days without signups are absent, no zero-fill; labels "M j"); plan distribution = raw `workspaces` (includes soft-deleted) grouped by `COALESCE(NULLIF(plan,''),'free')`, label ucfirst, ordered by count desc (shows raw slug/number strings as-is; QUIRK: numeric plan ids show as "1", "2"); devices = up to 8 Baileys devices ordered `active` desc, `id` desc, label "{name} · +{cc} {first 4 digits}xx", value `sent_24h` (QUIRK: never updated, see TW-DASH-014); leaderboard = paid orders since `since` (by `created_at`) joined to workspaces, `SUM(total_amount)` and count per workspace, top 8; ticket states = `support_tickets` grouped by status.
- **Rules & edge cases:**
  1. The growth and cohort charts plot the same series twice.
  2. Percent bars clamp at 100.
  3. All raw `DB::table` queries ignore soft deletes.
  4. The action queue threshold (<50% devices online) and the copy "Triage at /admin/support before SLA breach" are hard-coded.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given signups on 3 of the last 7 days, Then the growth chart shows 3 points (Reference) - rebuild should zero-fill to 7.
  - Given workspaces on plans starter (5) and pro (2), Then the donut shows 71% / 29% and the list shows the same.
  - Given no paid orders, Then the leaderboard shows the empty text and revenue composition shows "No paid revenue yet."
  - Given 2 of 6 devices online, Then the action queue shows "4 devices offline".
- **Source refs:** app/Http/Controllers/AdminPagesController.php (analytics), resources/views/admin/analytics/index.blade.php, resources/js/charts/admin-analytics-index.js
- **Port notes:** Zero-fill with `generate_series`; join plans by id; count devices across all engines; ticket counts from SUPP's service.

### TW-DASH-044 — Admin analytics signups CSV export

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-DASH-041
- **Summary:** "Export" on the admin analytics page downloads the daily signup counts for the selected days window as a CSV.
- **Actors & access:** As TW-DASH-041 (same route with `export=csv`).
- **UX & screens:** Button "Export" linking to `/admin/analytics?export=csv&days={days}`.
- **Endpoints:** `GET admin/analytics?export=csv&days=N` -> streamed `text/csv; charset=UTF-8` attachment `analytics-signups-{days}d-{YYYYMMDD-HHmm}.csv`.
- **Data:** header `date,signups`; one row per calendar date with at least one signup since `now - days`, ordered by date asc (no zero rows).
- **Rules & edge cases:**
  1. Only signups are exported; the page's other KPIs are not.
  2. No formula-injection guard is needed (dates and integers).
  3. Not audit-logged.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `days=7` with signups on two dates, Then the CSV has a header and two rows.
  - Given an unauthenticated request, Then it is redirected to login; a non-admin gets 403.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (analytics, export branch), resources/views/admin/analytics/index.blade.php
- **Port notes:** Add zero-filled dates and the KPI rows if desired; write an audit row for exports.

### TW-DASH-045 — Admin financial dashboard KPIs (revenue, MRR, ARR, refunds, outstanding)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PLAN, TW-PAYGW, TW-CPN
- **Summary:** `/admin/financial` opens with five money KPIs for a window chosen from 7d / 30d (default) / 90d / 1y.
- **Actors & access:** Platform admins (same middleware as TW-DASH-034).
- **UX & screens:** `resources/views/admin/financial/index.blade.php` (key `financial`, page key `admin-financial`). Header "Financial dashboard." with subtitle "MRR, ARR, payments, refunds and outstanding orders", window select (auto-submit), buttons "Invoices" (`admin.invoices.index`) and "Order history" (`admin.order-history.index`). KPI cards: Revenue (window) with delta pill; MRR (active) "Snapshot now"; ARR (projected) "MRR x 12"; Refunds "In window"; Outstanding "Pending orders". Search box with "CMD K" is decorative.
- **Endpoints:**

| Method uri          | Route name      | Controller@action               | Middleware                | Request                | Response |
| ------------------- | --------------- | ------------------------------- | ------------------------- | ---------------------- | -------- |
| GET admin/financial | admin.financial | Admin\FinancialController@index | auth, admin, ip-allowlist | `window`=7d/30d/90d/1y | HTML     |

- **Data:** window: days 7, 90, 365 else 30; same snapping as TW-DASH-034 rule 1. Revenue = paid revenue in `paid_at` window with delta vs previous window (2 dp; +100 when previous 0 and current > 0). MRR = sum, over workspaces joined to `packages.id = workspaces.plan` with `packages.free = false` and `packages.status = true`, of `offer_price` when > 0 else `plan_amount`. ARR = MRR x 12 (0 dp). Refunds = sum of paid-revenue expression over orders with `status = 'refunded'` and `updated_at` in the window. Outstanding = same over orders with `status = 'pending'` and `created_at` in the window. Order statuses: pending, paid, failed, refunded.
- **Rules & edge cases:**
  1. QUIRK: MRR counts every workspace on an active paid package once at its list price regardless of billing period (yearly or lifetime plans are not normalised), regardless of expired/trial state, and only workspaces whose `plan` column holds the numeric package id (slug-valued plans join to nothing; in Postgres the varchar-to-bigint join would error). Rebuild: derive MRR from active subscriptions normalised to monthly.
  2. Refunds are attributed to the order's last update date, not the refund date.
  3. Mixed-currency orders are summed raw (see TW-DASH-035).
  4. Only Revenue has a delta.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin `default_currency` symbol; `packages` catalogue.
- **Acceptance criteria:**
  - Given active paid workspaces on packages priced 29 (offer 19), 49 and 99, Then MRR = 19 + 49 + 99 = 167.00 and ARR = 2,004.
  - Given refunded orders updated in the window totalling 40, Then Refunds shows 40.00.
  - Given pending orders created in the window totalling 300, Then Outstanding shows 300.00.
  - Given `?window=1y`, Then all windowed KPIs use 365 days.
- **Source refs:** app/Http/Controllers/Admin/FinancialController.php (kpis), resources/views/admin/financial/index.blade.php, app/Models/Order.php, app/Models/Package.php (chargeableAmount)
- **Port notes:** `platform.billing.view` permission (exists in Reference's platform permission set) is the natural guard. Compute MRR in a `SubscriptionMetricsService` owned by PLAN and consume it here.

### TW-DASH-046 — Admin financial charts (revenue vs refunds, gateway mix, order status mix)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-DASH-045
- **Summary:** An area chart of daily paid revenue and daily refunds, a donut of revenue share by gateway, and a donut of order status counts.
- **Actors & access:** As TW-DASH-045.
- **UX & screens:** "Revenue over time" (`#financial-revenue-chart` area, height 280, series Revenue and Refunds, gradient fill, legend top; caption "Daily paid orders · {total}"). "Payment methods / Share by gateway" (`#financial-gateway-chart` donut, height 260, 5 colours; "No data" single slice of 1 when empty). "Order status / Mix in window" (`#financial-status-chart` donut, height 260).
- **Endpoints:** part of `GET admin/financial` (payload `window.adminFinancial`: `revenueDaily`, `refundsDaily`, `gateways`, `statusMix`).
- **Data:** revenueDaily = one point per calendar day from window start to end (zero-filled), `SUM(paid revenue)` grouped by `DATE(paid_at)`, labels "M j", total string; refundsDaily = same on refunded orders by `DATE(updated_at)`; gateways = all gateway slugs (not limited to 3) by paid revenue desc, ucfirst labels; statusMix = count of orders by `status` created in the window (any status), ucfirst.
- **Rules & edge cases:**
  1. `DATE()` grouping uses the database timezone while labels use the app timezone (equal in default UTC installs).
  2. Status donut counts by creation date while revenue counts by payment date.
  3. Orders with null gateway are excluded from the gateway share.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a 30-day window, Then the revenue chart has 31 points including zero-revenue days.
  - Given paid orders via stripe (900) and paypal (100), Then the donut shows Stripe and PayPal with those values.
  - Given no orders, Then both donuts render a single "No data" slice.
- **Source refs:** app/Http/Controllers/Admin/FinancialController.php (dailyRevenue, refundsDaily, gatewayBreakdown, statusMix), resources/js/charts/admin-financial.js
- **Port notes:** Bucket in the platform timezone; store refund events with their own timestamp.

### TW-DASH-047 — Admin financial tables (top paying workspaces, recent orders)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-DASH-045
- **Summary:** Two tables: the ten workspaces that paid the most in the window, and the eight most recent orders on the platform with status pills.
- **Actors & access:** As TW-DASH-045.
- **UX & screens:** "Top paying workspaces / Highest spend in window" (Workspace, Orders, Total; row click to the workspace detail; link "All workspaces"; empty "No paid orders yet in this window."). "Recent orders / Last 8 from the platform": Order #, Workspace, Plan, Amount, Status pill (paid green, pending amber, failed coral, refunded purple, else grey), When (relative). Empty "No orders yet."
- **Endpoints:** part of `GET admin/financial`.
- **Data:** Top: paid orders in window grouped by `workspace_id` with sum and count, top 10 by sum; workspace names looked up (fallback "Workspace #id", link "#" when missing). Recent: 8 latest orders by `created_at` any status; workspace and package looked up per row (N+1); amount = `total_amount ?? amount` formatted with the admin's symbol 2 dp; date = relative time.
- **Rules & edge cases:**
  1. Amounts are formatted in the admin currency symbol whatever the order's own currency.
  2. Not paginated; no filters or export here (Order history page and Invoices page are the drill-downs, owned by PLAN/CHK).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 12 paying workspaces, Then the top table lists 10 ordered by total desc.
  - Given 20 orders, Then the recent table lists the 8 newest with correct status colours.
  - Given a deleted workspace, Then its row shows "Workspace #id" and a non-navigating link.
- **Source refs:** app/Http/Controllers/Admin/FinancialController.php (topPayingWorkspaces, recentOrders), resources/views/admin/financial/index.blade.php
- **Port notes:** Show the order's own currency alongside a normalised base amount; batch the lookups with joins.

### TW-DASH-048 — System health: overall banner, core probes and 20-second live refresh

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-NODE, TW-SET (storage), TW-CORE
- **Summary:** `/admin/health` runs five independent probes (database, cache, queue, Node bridge, media storage), rolls them into an Operational / Degraded / Down banner and repaints the probe cards every 20 seconds by polling the same URL as JSON.
- **Actors & access:** Platform admins (same middleware as TW-DASH-034). The docs call it a v1.2 feature; no dedicated permission key.
- **UX & screens:** `resources/views/admin/health/index.blade.php` (key `health`, no page module; inline script). Banner: pulsing dot, "All systems - {Operational|Degraded|Down}", "Last checked HH:MM:SS · auto-refreshes every 20s", "Refresh now" button. "Core services" grid of cards (Database, Cache, Queue, Node bridge, Media storage): label, state badge (Operational green, Degraded amber, Down red, Idle grey), value (capitalised: driver / host / disk), detail line. Queue card has "Clear pending jobs" (TW-DASH-051). Polling: `fetch('/admin/health?format=json')` every 20 s and on "Refresh now"; repaints only the core cards' dots/badges/value/detail and the timestamp (QUIRK: the overall banner, latency bars, throughput, 24h counters, engines and vitals do not update until a full reload; failures are swallowed silently).
- **Endpoints:**

| Method uri       | Route name   | Controller@action            | Middleware                | Request                | Response                                                                              |
| ---------------- | ------------ | ---------------------------- | ------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| GET admin/health | admin.health | Admin\HealthController@index | auth, admin, ip-allowlist | `format=json` optional | HTML, or JSON `{checks, engines, system, overall, latency, throughput, activity, ts}` |

- **Data:** none stored. Probes: (1) Database: `select 1`, up with value = default connection name, detail "{ms} ms", `ping` ms; down on exception with the truncated (90 chars) message. (2) Cache: put `health:probe` = "1" for 10 s then read back; up "read/write ok", warn "write failed", down on exception; value = cache driver. (3) Queue: pending = count of `jobs`, failed = count of `failed_jobs`; warn when failed > 0 or pending > 500, else up; detail "{pending} pending · {failed} failed"; value = queue driver; down on exception. (4) Node bridge: base URL from admin `baileys_server_url` (fallback env `SERVER_URL`), warn "not configured / Set the server URL in settings" when empty; else HTTP GET base with header `X-Node-Token` (admin `node_webhook_token`, legacy key, or env `NODE_WEBHOOK_TOKEN`) and a 5 s timeout; ANY HTTP response (even 404/500) = up with detail "HTTP {status} · {ms} ms"; connection error = down "unreachable - process down?". (5) Media storage: on the configured media disk (`media_disk()`; local or cloud) write, read back and delete `health/.probe-{hash}`; up "read/write ok · {ms} ms", warn on mismatch, down on exception; value "cloud · {disk}" or "local · {disk}".
- **Rules & edge cases:**
  1. Overall = "down" if any core probe is down, else "warn" if any is warn, else "up" (engines, activity and vitals do not influence it).
  2. Every probe is wrapped so one failure downgrades only its card.
  3. The Node probe treats reachability, not correctness, as health.
  4. The page header comment mentions an "error log" probe; no such probe exists (docs-only).
  5. State labels: up = Operational, warn = Degraded, down = Down, idle = Idle.
- **Async & events:** client-side `setInterval` 20 s poll; no websocket.
- **External systems:** the Node WhatsApp bridge (HTTP GET, `X-Node-Token`); object storage via the media disk.
- **Settings:** admin `baileys_server_url`, `node_webhook_token`; env `SERVER_URL`, `NODE_WEBHOOK_TOKEN`, `QUEUE_CONNECTION` (default database), cache driver, media/cloud storage settings (SET).
- **Acceptance criteria:**
  - Given all probes succeed, Then the banner reads "All systems - Operational" and every card shows Operational.
  - Given the database probe throws, Then the Database card is Down and the banner reads Down while other cards still render.
  - Given 3 failed jobs, Then the Queue card is Degraded and the banner is Degraded.
  - Given the Node bridge answers 404, Then the Node card is Operational; given connection refused, Then Down.
  - Given `?format=json`, Then the response is JSON with a `ts` ISO-8601 timestamp and the same probe data.
  - Given the page stays open 60 s, Then the cards were repainted about three times without a reload.
- **Source refs:** app/Http/Controllers/Admin/HealthController.php, resources/views/admin/health/index.blade.php, app/Support/fc_helpers.php (tw_node_url, node_token, media_disk), Documentation/pages/admin-panel/system-health.html
- **Port notes:** `apps/api/src/modules/admin/health` (NestJS Terminus-style indicators): Postgres ping, Redis ping, BullMQ queue counts (waiting/failed per queue, warn thresholds 500 / >0), the WhatsApp bridge (the Baileys-equivalent NODE runtime), S3/MinIO put-get-delete. Replace `jobs/failed_jobs` with BullMQ queue metrics. Cache the result for a few seconds to protect against poll storms; also expose the banner in the polled payload (fixes the stale banner).

### TW-DASH-049 — System health: response-time bars, 14-day throughput and 24-hour activity counters

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-DASH-048
- **Summary:** Timing bars for the probes that measure latency, a 14-day message-volume line and four last-24-hour counters (messages, AI calls, conversations, webhooks).
- **Actors & access:** As TW-DASH-048.
- **UX & screens:** Counter tiles "Messages · 24h", "AI calls · 24h", "Conversations · 24h", "Webhooks · 24h". "Response time" card: bars for Database, Node bridge, Media storage with "{ms} ms", width = max(3, ms/maxMs*100)%, coloured by that probe's state; empty "No timing data." "Message throughput · 14 days" card: hand-drawn SVG polyline + gradient area over 14 daily values with "peak N/day"; empty "No message activity in the last 14 days."
- **Endpoints:** part of `GET admin/health` (HTML and JSON).
- **Data:** latency list from probes that returned `ping`. Throughput: 14 keys (today and 13 prior days), source = the first existing table among `inbox_messages`, `messages` (both directions, all statuses, raw query so soft-deleted rows count), counted per `DATE(created_at)` from the start of day 13 days ago. Activity (last 24h by `created_at`): messages = `inbox_messages` count, falling back to `messages` count only when the inbox count is 0; ai_calls = `ai_token_usage` rows; conversations = `conversations` rows created; webhooks = `incoming_webhook_events`, falling back to `webhook_logs` when 0 (that table does not exist in the schema, so it yields 0; outbound `webhook_deliveries` are not counted). Each counter is try/catch protected and returns 0 on failure or missing table/column.
- **Rules & edge cases:**
  1. The messages counter mixes both directions and (in the fallback) the legacy table, so it does not equal "messages sent".
  2. Counters are platform-wide across all tenants.
  3. No thresholds or alerts derive from these values.
- **Async & events:** none (static after page load; see TW-DASH-048 for the partial live refresh).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given messages on 5 of the last 14 days, Then the line has 14 points with zeros on the other days and the peak label shows the max.
  - Given 40 conversations created in the last 24 hours, Then the Conversations tile shows 40.
  - Given no data anywhere, Then the counters read 0 and the throughput card shows its empty text.
- **Source refs:** app/Http/Controllers/Admin/HealthController.php (throughput, activity24h, index latency), resources/views/admin/health/index.blade.php
- **Port notes:** Read from rollup counters or `count(*)` with `(created_at)` indexes; the platform-wide counts need the RLS-bypass role; include outbound webhook deliveries and both message directions explicitly labelled.

### TW-DASH-050 — System health: WhatsApp engine cards and host vitals

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-DASH-048, TW-WADEV, TW-WABA
- **Summary:** Per-engine cards showing connected versus total numbers with a status breakdown, and a "Host vitals" panel with runtime versions, disk and memory.
- **Actors & access:** As TW-DASH-048.
- **UX & screens:** "WhatsApp engines & connected numbers": one card per engine (Unofficial API, WhatsApp Cloud (WABA), Twilio) with a state dot (up green, down red, idle grey), "{connected} / {total}", caption "connected of total numbers" and chips "{status} {count}"; empty "No engines configured yet." "Host vitals": PHP version, Laravel version, Environment, Debug (on/off), Disk free ("{x.x} GB"), Memory limit, plus a disk-used bar (red above 90%, amber above 75%, else green).
- **Endpoints:** part of `GET admin/health` (JSON keys `engines`, `system`).
- **Data:** Unofficial: `devices` grouped by `status` across ALL workspaces; connected = status `connected`; total = sum; state idle when 0 total, up when connected > 0, else down. WABA/Twilio: `wa_provider_configs` for providers waba and twilio (meta_ads and other providers excluded), grouped by provider and status; connected = status in connected, active, verified; same state rule. Vitals: PHP_VERSION, framework version, app environment, debug flag, disk free and used % of the application base path, `memory_limit`.
- **Rules & edge cases:**
  1. Engine state never affects the overall banner.
  2. Other channels (Telegram, LINE, SMS, Email, Instagram...) have no health card.
  3. Vitals are the web-process host, not the Node bridge's host.
  4. Any query failure silently omits that engine.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 devices (2 connected, 1 disconnected), Then the Unofficial card shows "2 / 3", state up and chips "connected 2", "disconnected 1".
  - Given 2 Twilio configs both failed, Then the Twilio card shows "0 / 2" in red.
  - Given disk usage 92%, Then the disk bar is red.
- **Source refs:** app/Http/Controllers/Admin/HealthController.php (engines, system), resources/views/admin/health/index.blade.php
- **Port notes:** Replace PHP/Laravel vitals with Node version, NestJS/app version, environment, container disk/memory, worker process uptime; extend engine cards to every provider adapter that exposes a health method.

### TW-DASH-051 — System health: clear pending and failed jobs

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-DASH-048
- **Summary:** A one-click admin action on the Queue card that deletes every row in the `jobs` and `failed_jobs` tables and reports how many were removed. It exists because Reference is queue-less (no worker), so leftover rows are stale.
- **Actors & access:** Platform admins (same middleware). CSRF-protected POST.
- **UX & screens:** Button "Clear pending jobs" under the Queue card; browser confirm "Clear all pending & failed jobs? This app has no queue worker, so these are stale rows that will never run."; while running the button shows "Clearing..."; result line "Cleared {n} pending and {m} failed job(s)." (green) or "Failed: {message}" (red); then the cards re-poll immediately.
- **Endpoints:**

| Method uri                    | Route name               | Controller@action                 | Middleware                      | Request | Response                                                                        |
| ----------------------------- | ------------------------ | --------------------------------- | ------------------------------- | ------- | ------------------------------------------------------------------------------- |
| POST admin/health/clear-queue | admin.health.clear-queue | Admin\HealthController@clearQueue | auth, admin, ip-allowlist, csrf | none    | JSON `{ok, cleared_jobs, cleared_failed, message}` or 500 `{ok:false, message}` |

- **Data:** deletes all rows from `jobs` and `failed_jobs` (skips a table that does not exist), counting first.
- **Rules & edge cases:**
  1. QUIRK/danger: it deletes ALL jobs, including live ones on installs that do run a queue worker (the default `QUEUE_CONNECTION` is `database`); there is no per-queue or age filter and no audit row is written.
  2. Not idempotent-safe against concurrent workers.
  3. The Queue card returns to Operational after the delete because pending = failed = 0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 pending and 2 failed jobs, When the admin confirms, Then the response is `{ok:true, cleared_jobs:3, cleared_failed:2}` and the message reads "Cleared 3 pending and 2 failed job(s)."
  - Given the database errors, Then a 500 JSON with `ok:false` returns and the red failure line shows.
  - Given the admin cancels the confirm, Then nothing is sent.
- **Source refs:** app/Http/Controllers/Admin/HealthController.php (clearQueue), resources/views/admin/health/index.blade.php
- **Port notes:** In BullMQ map to "clean failed jobs" and "drain waiting jobs" per queue with explicit queue names, a confirmation naming the queue and count, and an audit row; never blanket-delete active/delayed jobs. Requires a platform permission (e.g. `platform.system.settings`).

### TW-DASH-052 — Chart rendering layer (ApexCharts, theme tokens, page initializers)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-ASHELL (layouts, theme), TW-SET (theme/branding tokens)
- **Summary:** The shared way every dashboard draws charts: server-computed data handed to a per-page ES module that builds ApexCharts instances using admin-controlled theme colours and the active currency symbol. The rebuild needs the same conventions (data contract, colour tokens, empty states, currency axis) in its chart components.
- **Actors & access:** Internal to all report pages.
- **UX & screens:** Library: ApexCharts (npm `apexcharts`, imported statically in most modules; the admin analytics module imports it dynamically and tolerates failure by drawing nothing). Chart types used by this domain: bar (grouped, stacked, horizontal, sparkline), line, area with gradient fill, donut, radialBar, radar, heatmap. Common style: font Plus Jakarta Sans (throughput chart uses Inter, mono JetBrains Mono for axis labels), grid lines dashed (stroke-dash 3-4) in the paper-100/200 token, axis labels 10-11 px ink-500, no toolbar, legends bottom or top 11 px, donut separators in paper-0, smooth curves. Colours come from `themeColor(token)` which reads the live CSS variable `--color-<token>` (falling back to a built-in hex map: wa-deep #075E54, wa-teal #128C7E, wa-green #25D366, accent-coral #E87A5D, accent-amber #E5A04E, accent-plum #5B3D8A, ink and paper tokens...) so a re-branded install recolours charts; `themeAlpha(token, a)` returns rgba for fills. A handful of literal hex colours remain (pastel donut slices #D9E5F2, #F3E9FF, #FFF4E0; IG gradient), which the admin theme cannot recolour. Currency axes and tooltips use `window.WA_CURRENCY`, read from `<meta name="currency-symbol">` printed by the layout (`'$'` fallback).
- **Endpoints:** none. Loading pattern: the layout emits `data-page="<page key>"`; `app.js` holds a registry (`PAGE_INITIALIZERS`) mapping the key to a dynamic import of `resources/js/charts/<module>.js` whose default export runs on DOM ready. Data reaches the module via `window.<Name> = @json(...)` inline scripts (`adminOverview`, `adminFinancial`, `DASHBOARD_DATA`, `ANALYTICS_DATA`) or JSON `data-*` attributes on the chart container (admin analytics). Page keys owned here: `admin-overview`, `admin-financial`, `admin-analytics-index`, `user-dashboard-index`, `user-analytics-index`.
- **Data:** none.
- **Rules & edge cases:**
  1. Empty-state conventions: donuts render a single placeholder slice (`[1]` labelled "No data"/"No plans") when the series is empty; bar/list charts replace the container with a short message (e.g. "No sends yet", "No connected devices yet.", "No message volume in this window."); sparklines render `[0]`.
  2. Charts inside hidden tab panels do not measure a width; the admin analytics module re-fires resize after each tab switch; the throughput chart dispatches a window resize 300 ms after render to counter card entrance animations.
  3. There is no client-side data fetching, refetching or streaming: charts update only on full page reload (health polling is the only XHR and it updates text, not charts).
  4. No caching layer: all data is computed per request; the only caches are a 5 s per-workspace engine-scope cache and 60 s currency caches.
  5. No accessible text alternative or keyboard interaction for charts; tooltips are Apex defaults.
  6. Theme changes apply on reload because colours are sampled at init.
  7. 37 of the 161 modules under `resources/js/charts/` create charts; the other 124 are behavior scripts for forms and lists (the folder name is historical). Ownership of every chart module is listed in the appendix "Chart widget catalogue".
- **Async & events:** none.
- **External systems:** none (Google fonts/CDN not involved in charts).
- **Settings:** admin theme colour overrides (`--color-*` tokens written by the theme CSS helper, SET/ASHELL), admin default currency (symbol).
- **Acceptance criteria:**
  - Given an admin recolours `wa-deep`, When a chart page loads, Then the primary series uses the new colour.
  - Given a series is empty, When the chart initialises, Then a placeholder or message shows and no console error is thrown.
  - Given the default currency is INR, When the admin revenue chart renders, Then its y-axis labels are prefixed with the rupee symbol.
  - Given a hidden tab panel becomes visible, Then its chart redraws at the container's full width.
- **Source refs:** resources/js/app.js (PAGE_INITIALIZERS), resources/js/theme-colors.js, resources/js/threadwise.js (WA_CURRENCY), resources/js/charts/admin-overview.js, resources/js/charts/admin-financial.js, resources/js/charts/admin-analytics-index.js, resources/js/charts/user-analytics-index.js, resources/js/charts/user-dashboard-index.js, resources/views/components/layouts/admin.blade.php, resources/views/components/layouts/user.blade.php
- **Port notes:** In `apps/web` build a small `<Chart>` wrapper (Recharts or ApexCharts via react-apexcharts) taking `{type, series, categories, currency}`; theme tokens as CSS variables consumed through a `useThemeColor` hook; SSR-safe (charts render client-side only). Keep the API returning chart-ready payloads (`labels`, `series[]`) so the frontend stays thin.

### TW-DASH-053 — Time zone, currency and number-format conventions on report pages

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN (currency), TW-SET (timezone), TW-I18N
- **Summary:** The rules that decide which time zone a window is cut in and which currency symbol and number format a figure shows. Getting these right prevents most numeric parity bugs.
- **Actors & access:** Internal.
- **UX & screens:** Effects on every figure and label.
- **Endpoints:** none.
- **Data:** `workspaces.timezone` (default UTC), `workspaces.currency`, `users.locale`, system settings `default_currency`, `default_timezone`, `app_name`; `currencies` table (code, symbol, precision, exchange_rate versus USD).
- **Rules & edge cases:**
  1. Windows and daily buckets on the workspace dashboard and analytics use the application timezone (`app.timezone`, UTC by default), not the workspace timezone. Exceptions: the greeting/date on the dashboard and the analytics heatmap (with its "UTC+x" label) use the workspace timezone (`wa_tz()` order: explicit, workspace, user, `default_timezone`, `app.timezone`, UTC).
  2. Admin pages use the application timezone throughout.
  3. Workspace pages format money in the workspace currency, else the admin default currency, else USD (`FormatSettings::currencyFor`). Admin pages call `FormatSettings::symbol()` with no workspace, which resolves the signed-in admin's CURRENT workspace currency when one is set (QUIRK: an admin parked on a client's workspace sees that client's symbol on platform-wide totals); otherwise the platform default currency.
  4. Money is formatted with thousands separator "," and the currency's precision (2 by default); KPI cards on admin overview use 2 decimals, MRR/ARR and workspace MRR 0-2 as specified per card. Symbols may be HTML entities (rendered unescaped).
  5. Percentages: rates 1 decimal; admin overview deltas 2 decimals; dashboard deltas 1 decimal; percentage-point deltas suffixed "pp".
  6. Counts abbreviate only in specific places: throughput legend (1.2k, 1.5M), y-axis (1000 -> 1k), admin workspace messages ("1.2k", "3m").
  7. Relative times ("3 hours ago") come from server-side Carbon and are localised by the app locale; most static labels are wrapped in the translation helper but a number of strings are hard-coded English (KPI titles, chart series names, footers), which the rebuild must externalise (I18N).
  8. Timestamps are stored UTC; `DATE()` grouping in SQL happens in the database timezone (UTC).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** listed under Data.
- **Acceptance criteria:**
  - Given a workspace in Asia/Kolkata, When the heatmap renders, Then its badge reads "UTC+5:30" and hours are local.
  - Given a workspace currency of GBP and default USD, When the dashboard pipeline strip renders, Then amounts show the pound symbol.
  - Given an admin with no current workspace currency, When the admin overview renders, Then figures use the platform default currency symbol.
  - Given the rebuild, When any window is cut, Then it uses the workspace timezone consistently (recorded deviation from Reference).
- **Source refs:** app/Support/FormatSettings.php, app/Support/fc_helpers.php (wa_tz), resources/views/components/layouts/admin.blade.php, resources/views/components/layouts/user.blade.php, resources/js/threadwise.js
- **Port notes:** One `formatMoney(amountMinor, currency, locale)` and `windowFor(range, tz)` in `packages/` shared code; admin platform pages should always use the platform base currency and be explicit about it.

### TW-DASH-054 — Dead and legacy code in the dashboard area

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** Code and assets that exist in Reference but nothing reaches; listed so nobody ports them by mistake.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. `AdminPagesController@dashboard` returns the `admin.dashboard.index` view with no data; no route points to it (the route uses `OverviewController@index`); calling it would error on missing variables.
  2. `resources/js/charts/analytics-index.js` (197 lines) is an older synthetic-data version of the user analytics charts (random series generator); registered as page key `analytics-index` but no view uses that key.
  3. `resources/js/charts/user-overview.js` is a static demo (hard-coded sparkline values, "k msg/h" tooltip); registered as `user-overview` with no view.
  4. `quickAccessInit()` at the bottom of `user-dashboard-index.js` is intentionally uncalled (the modal is initialised globally by `app.js`).
  5. Computed-but-unrendered values in `UserPagesController@dashboard`: `geoRows`, `geoOther`, `geoMarkets`, `geoMax` (a contacts-by-country panel that was replaced by the flows card), `optOutPct` (constant 0), `estMessages`, `newContacts`; in `@analytics`: `metaTotalSpend`, `metaTotalRevenue`, `metaActive`. Duplicate legacy chart modules with no view (billing-history-_, campaigns-analytics, meta-ads-analytics_, workspaces-detail) belong to their own domains but are noted here.
  6. The "Pause" button on the analytics event stream and the decorative "Live" chips have no behavior.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the rebuild backlog, When these items are reviewed, Then none is implemented unless a live feature requires an equivalent.
  - Given the parity checker lists `AdminPagesController@dashboard`, Then it is marked not-applicable.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (dashboard), resources/js/charts/analytics-index.js, resources/js/charts/user-overview.js, resources/js/charts/user-dashboard-index.js, app/Http/Controllers/UserPagesController.php
- **Port notes:** Do not port. Referenced only so the coverage audit shows a deliberate decision.

## Data model

This domain owns no tables and no models. Every figure is a live aggregate over tables owned by other domains; the only writes are `users.quick_access` (TW-DASH-009) and the destructive delete of `jobs` / `failed_jobs` (TW-DASH-051). Columns below are the ones the dashboards depend on. Volume note: `messages` and `inbox_messages` are the high-volume tables; every dashboard load scans them by workspace and time, so the rebuild needs `(org_id, created_at)` and `(org_id, direction, status, created_at)` indexes and SQL aggregation (Reference loads rows into PHP for the throughput buckets, message types and team rollups).

| Table                           | Owner                | Columns used                                                                                                                                                                                                                       | Read by                                                 |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `messages`                      | CHAT/BCAST           | `workspace_id`, `user_id`, `provider`, `direction`, `status` (pending, queued, sent, delivered, read, failed), `template_id`, `media_type`, `read_at`, `from_number`/`to_number` (encrypted), `created_at`, soft delete            | 002, 004-005, 012, 015, 018, 023-029, 035, 039-040, 049 |
| `inbox_messages`                | TIB1                 | same as above but no `workspace_id` (scoped via `conversation_id`), `provider`                                                                                                                                                     | 002, 004-005, 012, 018, 023-031, 035, 049               |
| `conversations`                 | TIB1                 | `workspace_id`, `provider`, `channel`, `device_id`, `archived`, `unread_count`, `last_message_at`, `last_inbound_at`, `last_outbound_at`, `assignee_user_id`, `first_response_at`, `resolved_at`, `title`, `raw_jid`, `created_at` | 008, 016, 018, 023, 025, 028, 030, 031, 049             |
| `csat_responses`                | TIB2                 | `conversation_id`, `rating` (1-5)                                                                                                                                                                                                  | 030                                                     |
| `contacts`                      | CON                  | workspace scope fields, `is_unsubscribed`, `created_at`, `country_code` (dial prefix)                                                                                                                                              | 006                                                     |
| `broadcasts`                    | BCAST                | `workspace_id`, `provider`, `status`, `name`, `template_id`, `total_recipients`, `success_count`, `updated_at`                                                                                                                     | 013                                                     |
| `wpcampaigns`                   | CAMP                 | `created_at` (count only)                                                                                                                                                                                                          | 032                                                     |
| `wa_templates`                  | TPL                  | `template_name` (encrypted), `category`, `language`, `template_type`, `status`, `provider_config_id`, `updated_at`                                                                                                                 | 015, 028                                                |
| `devices`                       | WADEV                | `workspace_id`, `user_id`, `device_name`, `phone_number`, `country_code`, `region`, `active`, `status`, `sent_24h`, `failed_24h` (never written by app code), `last_seen_at`                                                       | 014, 026, 029, 042, 043, 050                            |
| `wa_provider_configs`           | WABA                 | `workspace_id`, `provider` (waba, twilio, sms, meta_ads), `status` (pending, connected, disconnected, failed), `phone_number`, `display_label`, `connected_at`                                                                     | 014, 026, 048-050                                       |
| `workspace_ig_accounts`         | IG                   | `workspace_id`, `status`, `followers`, `username`, `name`, `avatar`                                                                                                                                                                | 008                                                     |
| `flows`, `flow_subscribers`     | FLB/FLR              | `workspace_id`, `flow_name`, `is_active`, `trigger_kind`, `flow_data` (nodes), `updated_at`; subscribers by `flow_id`                                                                                                              | 017                                                     |
| `deals`                         | DEAL                 | workspace, `status` (open/won/lost), `value_minor`, `currency`, `won_at`                                                                                                                                                           | 011                                                     |
| `audit_logs`                    | NOTIF                | `workspace_id`, `actor_user_id`, `action`, `subject_type`, `created_at`                                                                                                                                                            | 019                                                     |
| `webhook_deliveries`            | INTG                 | `fired_at` (platform-wide count)                                                                                                                                                                                                   | 020                                                     |
| `meta_campaigns`                | MADS                 | `workspace_id`, `status`, `insights` JSON (spend, revenue)                                                                                                                                                                         | 033 (unrendered)                                        |
| `users`                         | AUTH                 | `current_workspace_id`, `name`, `email`, `wallet_credits`, `quick_access` (JSON, WRITTEN here), `country_code`, `created_at`, `role`, soft delete                                                                                  | 001, 007, 009, 010, 030, 035-037                        |
| `workspaces`                    | WSP                  | `plan` (varchar, slug or package id), `timezone`, `currency`, `enabled_engines`, `default_engine`, `industry`, `status` (0 = pending), `last_active_at`, `owner_user_id`, `created_at`, soft delete                                | 001, 038-040, 042-043, 045                              |
| `orders`                        | PLAN/PAYGW           | `workspace_id`, `package_id`, `gateway_slug`, `currency`, `amount`, `total_amount`, `status` (pending, paid, failed, refunded), `paid_at`, `failure_reason`, `order_number`, `created_at`, `updated_at`                            | 035-036, 038, 040, 042-043, 045-047                     |
| `packages`                      | PLAN                 | `pname`, `free`, `status`, `plan_amount`, `offer_price`, feature flags incl. `access_analytics`, `access_sales_pipeline`                                                                                                           | 011, 022, 038, 039, 045                                 |
| `support_tickets`               | SUPP                 | `status` (open, in_progress, pending, resolved...)                                                                                                                                                                                 | 042-043                                                 |
| `ai_token_usage`                | AIADM                | `created_at`                                                                                                                                                                                                                       | 049                                                     |
| `incoming_webhook_events`       | INTG                 | `created_at`                                                                                                                                                                                                                       | 049                                                     |
| `jobs`, `failed_jobs`           | CORE (Laravel queue) | row counts; deleted by 051                                                                                                                                                                                                         | 048, 051                                                |
| `currencies`, `system_settings` | CPN / SET            | symbol, precision, exchange_rate; `default_currency`, `default_timezone`, `credits_per_message`, `baileys_server_url`, `node_webhook_token`, `security.ip_allowlist_*`, `app_name`, `allowed_send_methods`                         | 007, 011, 035, 048, 053                                 |

Enums used: message `direction` in/out; message `status` above; broadcast status vocabulary (running: sending/running/processing/active; scheduled: scheduled/pending/queued; paused: paused/failed/cancelled; done: completed/done/sent); order `status` pending/paid/failed/refunded; device `status` connected/connecting/disconnected; heatmap weekday 0=Sunday.

JSON shapes owned here: `users.quick_access` = array (max 10) of `{key: <catalog key>}` or `{label: string<=40, url: string<=255 starting with "/" or http(s)://}`; the polled health payload = `{checks: {database|cache|queue|node|storage: {state: up|warn|down, label, value, detail, ping?, pending?, failed?, http?}}, engines: [{key, label, connected, total, state: up|down|idle, breakdown: {status: count}}], system: {php, laravel, env, debug, disk_free?, disk_used_pct?, memory_limit}, overall: up|warn|down, latency: [{label, ms, state}], throughput: {source, series: {date: count}}, activity: {messages, ai_calls, conversations, webhooks}, ts}`.

## Cross-domain contracts

Consumes:

- CHAT / TIB1 / BCAST / CAMP / SCHED: the message and conversation status vocabulary (`direction`, `status`, `read_at`, `provider`, `template_id`, `media_type`, `first_response_at`, `resolved_at`). Contract: a single documented status enum; delivery receipts must set `read_at`. `devices.sent_24h/failed_24h` must either be maintained by WADEV or replaced by a live query.
- WADEV / WABA / NODE: the enabled-engine set (`enginesFor(ws)`), connected sender list per engine, bridge base URL and token (for the health probe).
- PLAN / PAYGW / CPN: orders and their status lifecycle, `paid_at`, gateway slugs, package price fields and a proper MRR calculation; currency conversion and symbols (`FormatSettings`).
- RBAC / PLAN: `EnsureWorkspaceRole` (manager+) and the entitlement guard for `access_analytics`, `access_sales_pipeline`; platform-admin check and IP allowlist (ASHELL/RBAC).
- WSP: current workspace resolution, `timezone`, `currency`, `status` (pending approval), `last_active_at` maintenance, impersonation flag.
- CON, DEAL, FLB/FLR, NOTIF (audit log), SUPP (tickets), AIADM (`ai_token_usage`), INTG (webhook tables), IG (Instagram accounts), WALLET (`wallet_credits`, per-credit rate, pay-per-message flag).
- I18N: string externalisation for every label here (many are hard-coded English in Reference).

Exposes:

- To ASHELL: the Quick-access drawer/modal components and the `users.quick_access` preference; the `/home` router; the chart layer conventions (TW-DASH-052) reused by every domain's detail pages.
- To all domains: the metric definitions in TW-DASH-002 (delivered set, read rule, percent-change rule) so campaign, broadcast and inbox pages report the same numbers.
- To PLAN/SET: the health payload shape (TW-DASH-048) if another surface (status page, ops alerts) wants the same probes.
- To NOTIF: no events emitted; the alerts panel could later become notification triggers (payment failed, spike, pending workspaces).

## Open questions & quirks

Numbered so features can cite them. Decisions in bold are needed from the product owner before the rebuild ships.

1. **Slug vs id in `workspaces.plan` (QUIRK, likely defect).** Admin overview (premium count, workspace plan pill, MRR) and financial (MRR) join `packages.id = workspaces.plan`, but the column defaults to the slug "starter" and the Workspace model resolves either a slug or a numeric id. Slug-valued workspaces are silently treated as Free with MRR 0; admin analytics groups by the raw string. **Decide the canonical plan reference (foreign key) in PLAN and compute MRR from subscriptions.**
2. **Three revenue definitions.** Overview and financial use `paid_at` and `COALESCE(total_amount, amount)`; admin analytics uses `created_at` and `total_amount` only; none converts currencies although orders carry `currency`, `base_amount_usd`, `exchange_rate`. **Define one base-currency revenue metric.**
3. **Revenue chart truncation (QUIRK).** TW-DASH-036: 12 fixed buckets miss the newest days for 30d, 90d and 1y windows, so the header "Total revenue" is below the KPI. Fix in the rebuild and note as an intentional deviation.
4. **Window off-by-one (QUIRK).** "Last 24 hours" on admin overview is yesterday plus today; "7 days" is 8 calendar days; previous windows are slightly longer than current ones on the workspace dashboard. **Decide exact rolling windows.**
5. **Country data on admin overview.** `users.country_code` holds the phone dial prefix, not ISO, so the country list and region radar are wrong or empty; docs say the platform stores no country and call the panels illustrative. **Decide whether to keep the panels; if yes store ISO country.**
6. **`devices.sent_24h` / `failed_24h` are never updated (QUIRK).** Only seeders and the warmer read them, so the dashboard devices card, analytics geography and admin "top devices" show zeros on real installs. Replace with live queries.
7. **Per-device analytics query (probable defect).** TW-DASH-026 filters encrypted `from_number` columns with a plaintext equality; expected to match nothing. Verify against the running reference before deciding the rebuild's device attribution key.
8. **Admin analytics "Messages" KPI always "-".** Reads a non-existent `messages_outbound` table; the try/catch hides it (TW-DASH-042).
9. **Sent series definition (QUIRK).** The analytics daily "Sent" excludes failed messages and the "Queued" derivation subtracts failed again; the KPI "Total messages" includes failed. Dashboard counts `sent` status as delivered. **Decide the status vocabulary and whether `sent` means handed-to-provider.**
10. **Engine filter inconsistencies (QUIRK).** Applied to current-window analytics counts but not to previous windows, unique-recipient count, funnel repliers on analytics, dashboard peak/avg hour, analytics heatmap or the analytics event stream. Apply one rule everywhere.
11. **Analytics labels that lie.** Hero "reached their reader this week" (any range), "Total messages · all time" (windowed), heatmap "Read rate" (message counts), throughput badge "UTC+1" (hard-coded), KPI "Messages sent · 7d" (any range), dashboard "Live · synced 4s ago" and analytics "Live" / "refreshed just now" (static), funnel "last 7 days" (any range), "Activity log ... auto-refresh" (no refresh), "Meta-approved only" on top templates (not filtered), "Sales by platform / E-commerce integrations" (payment gateways), "Session by country" and "Sales by region" (signups).
12. **"Top" lists are not top (QUIRK).** Top templates (dashboard: 5 latest updated; analytics: 8 latest updated, sends from the legacy table only) and top contacts (5 of the 20 most recent conversations) rank only a recent subset.
13. **Dashboard integrations panel is mostly placeholder (QUIRK).** WooCommerce state comes from platform-wide outbound webhook deliveries, Shopify is hard-coded false, Sheets reads a non-existent attribute, and "12" is a constant (TW-DASH-020).
14. **Soft plan gate (QUIRK).** `EnforcePlanFeature` does not block GET requests; `/analytics` and `/analytics/export` return data even without `access_analytics`. **Decide hard vs soft entitlement.**
15. **Wallet card reads the user's credits, not the workspace's** (TW-DASH-007), and is hidden when credits are 0 (credits were reverted in Reference).
16. **Quick access limits (QUIRK).** Cannot save an empty list (defaults return); no ordering although the drawer tooltip claims reordering; duplicate keys accepted; no role/plan filtering of tiles.
17. **Health page.** Polling repaints only the core cards, not the banner or lower panels; the header comment promises an error-log probe that does not exist; `clear-queue` deletes every job without audit and conflicts with the default database queue driver; docs call it v1.2.
18. **Docs versus code.** Docs describe admin health thresholds Good/Watch/Risk at 50,000/5,000 messages (code: Good 500+, Active 50+, Low >0, Idle 0); docs say platform admins land on the Users page after login (code redirects to `/admin`, comment says `/admin/users`); docs list "Schedule report" (docs-only, TW-DASH-033); docs say the analytics "By number" panel shows per-number sends (counts likely zero, item 7).
19. **Performance.** The workspace dashboard issues dozens of queries per view, loads all outbound rows of the quarter into PHP for the four throughput ranges, and runs N+1 lookups (template stats, audit actors, top contacts). Analytics loads all outbound rows for the message-type mix. Rebuild with SQL aggregation and parallel card endpoints.
20. **Tenant leakage risks in Reference to avoid.** NULL-workspace fallback rows visible across users; platform-wide `webhook_deliveries` counted on a workspace card; raw `DB::table` admin queries include soft-deleted rows. RLS in the rebuild removes the first two; make soft-delete handling explicit in admin queries.
21. **Where do other analytics pages belong?** Not claimed here (owned by the domain that owns the data): `GET admin/ai-dashboard` (AIADM), `GET admin/bsp` and `admin/bsp/dashboard` (BSP), `GET admin/premium` and `admin/packages/analytics/*` (PLAN), `GET admin/billing-history/analytics` (WALLET), `GET admin/order-history/analytics` (CHK), `GET admin/support/reports` and `export.csv` (SUPP), `GET|PATCH admin/settings/analytics` (site tracking snippet, SET/CMS), `GET team-inbox/analytics/team|ai-agents` and `team-inbox/api/analytics/*`, `team-inbox/api/stats` (TIB2), `GET flows/analytics*` (FLR), `GET deals/reports` and `GET crm` (DEAL/CTP), `GET meta-ads/analytics` (MADS), `GET facebook|line|tiktok|viber|wechat/insights` (channel domains), `GET devices/waba/{id}/health(.json)` (WABA), Shopify / WooCommerce / HubSpot / Slack / Trello dashboards (ECOM, INTG), `GET activity-log/export`, `message-history/export`, `broadcasts/{id}/export|live-stats`, `wa-campaigns/{id}/export`, `settings/export/{type}` (owning domains). If a writer of those domains does not claim them, the coverage audit will list them as orphans and they should be re-homed rather than dropped.
22. **Route claimed with another domain.** `GET home` (the post-login router) is shared with AUTH; `POST quick-access`, the quick-access drawer/modal components and the `users.quick_access` column are claimed here but could equally sit in ASHELL (shell UI).
23. **Catch-all controllers.** `UserPagesController` also serves `connect`, `guidebook*`, `integrations`, `more`, `notifications-page`, `settings*` and other routes, and `AdminPagesController` serves most admin pages (users, workspaces, packages, support, settings). Only `dashboard`, `analytics`, `analyticsExport` (user) and `analytics`, plus the dead `dashboard` stub (admin), are claimed here; the controller files are listed in coverage because those actions live in them, and all other routes belong to the domain of the data they serve (see item 21 and the other inventory files).

## Appendix: chart widget catalogue

`resources/js/charts/` holds 161 page-initialiser modules (the name is historical). 37 create ApexCharts (below); 8 are not referenced by the page registry (auth-recaptcha, campaigns-create, campaigns-edit, inbox-merge-duplicates, meta-ads-targeting, sched-confirm-modal, template-live-mapping (loaded by presence of a DOM hook instead), user-store-products-form). Metric definitions, filters and date ranges for widgets owned by other domains live in those domains' inventory files; this table fixes the owner and chart types so the port keeps one rendering convention. Widgets of the DASH-owned pages: user dashboard (`#kpi-spark` sparkline bar, `#kpi-readrate` radialBar, `#chart-throughput` grouped bar), user analytics (`#hero-spark`, `#chart-volume` area, `#chart-totals` stacked bar, `#chart-rates` donut, `#chart-types` donut, `#chart-devices` horizontal bar, `#chart-heatmap`), admin overview (`#admin-revenue-chart` line, `#admin-region-chart` radar, `#admin-platform-chart` donut, `#admin-users-chart` radialBar), admin financial (`#financial-revenue-chart` area, `#financial-gateway-chart` donut, `#financial-status-chart` donut), admin analytics (`#chart-platform-growth` area, `#chart-module-mix` donut, `#chart-delivery` horizontal bar, `#chart-retention` column). None has server-side caching; all take their date range from the page's query string and reload the page to change it.

| Module                                      | Owner           | View                            | Chart types                     | Chart ids                                                                                                                                   |
| ------------------------------------------- | --------------- | ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `charts/admin-analytics-index.js`           | DASH            | admin/analytics/index           | area, bar, donut                | #chart-delivery, #chart-module-mix, #chart-platform-growth, #chart-retention                                                                |
| `charts/admin-billing-history-analytics.js` | WALLET          | admin/billing-history/analytics | area, donut                     | #chart-billing-trend, #chart-gateway-mix, #chart-status-mix                                                                                 |
| `charts/admin-billing-history-index.js`     | WALLET          | admin/billing-history/index     | area                            | #chart-billing                                                                                                                              |
| `charts/admin-financial.js`                 | DASH            | admin/financial/index           | area, donut                     | #financial-gateway-chart, #financial-revenue-chart, #financial-status-chart                                                                 |
| `charts/admin-overview.js`                  | DASH            | admin/dashboard/index           | donut, line, radar, radialBar   | #admin-platform-chart, #admin-region-chart, #admin-revenue-chart, #admin-users-chart                                                        |
| `charts/admin-premium.js`                   | PLAN            | admin/premium/index             | area, bar, donut                | #premium-mix-chart, #premium-revenue-chart, #premium-upgrades-chart                                                                         |
| `charts/admin-workspaces-detail.js`         | WSP             | admin/workspaces/detail         | area                            | #chart-volume                                                                                                                               |
| `charts/analytics-index.js`                 | DASH (dead)     | (no view)                       | area, bar, donut, heatmap       | #chart-devices, #chart-heatmap, #chart-rates, #chart-totals, #chart-types, #chart-volume, #hero-spark                                       |
| `charts/billing-history-analytics.js`       | WALLET (legacy) | (no view)                       | area, donut                     | #chart-currency, #chart-flow, #chart-gateway                                                                                                |
| `charts/billing-history-index.js`           | WALLET (legacy) | (no view)                       | area                            | #chart-billing                                                                                                                              |
| `charts/campaigns-analytics.js`             | CAMP (legacy)   | (no view)                       | area, bar, donut                | #chart-replies, #chart-status, #chart-trend                                                                                                 |
| `charts/devices-detail.js`                  | WADEV           | admin/devices/detail            | bar, donut, heatmap             | #chart-heatmap, #chart-status, #chart-volume                                                                                                |
| `charts/meta-ads-analytics-detail.js`       | MADS (legacy)   | (no view)                       | area, bar, donut                | #chart-outcomes, #chart-placement, #chart-trend                                                                                             |
| `charts/meta-ads-analytics.js`              | MADS (legacy)   | (no view)                       | area, bar, donut, line          | #chart-audience, #chart-outcomes, #chart-placement, #chart-revenue, #chart-trend                                                            |
| `charts/order-history-analytics.js`         | CHK             | admin/order-history/analytics   | bar, donut                      | #chart-motion, #chart-type                                                                                                                  |
| `charts/packages-analytics.js`              | PLAN            | admin/packages/analytics        | area, donut                     | #chart-mrr, #chart-share                                                                                                                    |
| `charts/user-activity-log-index.js`         | NOTIF           | user/activity-log/index         | bar, donut                      | #chart-categories, #chart-direction, #chart-volume                                                                                          |
| `charts/user-affiliate-history-index.js`    | CPN             | user/affiliate-history/index    | bar, line                       | #chart-volume                                                                                                                               |
| `charts/user-analytics-index.js`            | DASH            | user/analytics/index            | area, bar, donut, heatmap       | #chart-devices, #chart-heatmap, #chart-rates, #chart-totals, #chart-types, #chart-volume, #hero-spark                                       |
| `charts/user-auto-reply-keyword.js`         | AR              | user/auto-reply/keyword         | area, donut, heatmap            | #chart-heatmap, #chart-triggers, #chart-variants                                                                                            |
| `charts/user-broadcasts-show.js`            | BCAST           | user/broadcasts/show            | area, bar, donut                | #chart-delivery, #chart-failures, #chart-status                                                                                             |
| `charts/user-dashboard-index.js`            | DASH            | user/dashboard/index            | bar, radialBar                  | #chart-throughput, #kpi-readrate, #kpi-spark                                                                                                |
| `charts/user-deals-reports.js`              | DEAL            | user/deals/reports              | bar                             | #dl-chart-stage, #dl-chart-trend                                                                                                            |
| `charts/user-devices-detail.js`             | WADEV           | user/devices/detail             | bar, donut, heatmap             | #chart-heatmap, #chart-status, #chart-volume                                                                                                |
| `charts/user-facebook-insights.js`          | FB              | user/facebook/insights          | area                            | #fb-activity-chart                                                                                                                          |
| `charts/user-flows-analytics.js`            | FLR             | user/flows/analytics            | area, bar, donut                | #chart-fa-failures, #chart-fa-status, #chart-fa-trend                                                                                       |
| `charts/user-message-history-index.js`      | CHAT            | user/message-history/index      | bar, donut                      | #chart-direction, #chart-types, #chart-volume                                                                                               |
| `charts/user-meta-ads-analytics.js`         | MADS            | user/meta-ads/analytics         | area, bar, donut, line          | #chart-outcomes, #chart-trend, #ma-chart-data                                                                                               |
| `charts/user-overview.js`                   | DASH (dead)     | (no view)                       | bar, radialBar                  | #chart-throughput, #kpi-readrate, #kpi-spark                                                                                                |
| `charts/user-scheduled-detail.js`           | SCHED           | user/scheduled/detail           | area, donut                     | #chart-engage, #chart-status                                                                                                                |
| `charts/user-shopify-dashboard.js`          | ECOM            | user/shopify/dashboard          | area, bar, line                 | #forecast-chart, #revenue-chart, #yoy-chart                                                                                                 |
| `charts/user-store-index.js`                | STORE           | user/store/index                | bar, line                       | #store-sales-chart                                                                                                                          |
| `charts/user-wa-campaigns-detail.js`        | CAMP            | user/wa-campaigns/detail        | area, bar, donut, heatmap, line | #chart-delivery, #chart-engagement, #chart-failures, #chart-intents, #chart-read-heatmap, #chart-segments, #chart-status, #chart-throughput |
| `charts/user-webhooks-detail.js`            | INTG            | user/webhooks/detail            | area, donut                     | #chart-activity, #chart-codes                                                                                                               |
| `charts/user-webhooks-index.js`             | INTG            | user/webhooks/index             | area                            | #chart-activity                                                                                                                             |
| `charts/user-woocommerce-dashboard.js`      | ECOM            | user/woocommerce/dashboard      | area, bar, line                 | #forecast-chart, #revenue-chart, #yoy-chart                                                                                                 |
| `charts/workspaces-detail.js`               | WSP (legacy)    | (no view)                       | area                            | #chart-volume                                                                                                                               |

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET home",
    "GET dashboard",
    "POST quick-access",
    "GET analytics",
    "GET analytics/export",
    "GET admin",
    "GET admin/analytics",
    "GET admin/financial",
    "GET admin/health",
    "POST admin/health/clear-queue"
  ],
  "controllers": [
    "app/Http/Controllers/Admin/OverviewController.php",
    "app/Http/Controllers/Admin/FinancialController.php",
    "app/Http/Controllers/Admin/HealthController.php",
    "app/Http/Controllers/QuickAccessController.php",
    "app/Http/Controllers/UserPagesController.php",
    "app/Http/Controllers/AdminPagesController.php"
  ],
  "services": ["app/Support/QuickAccess.php"],
  "models": [],
  "tables": [],
  "views": [
    "resources/views/user/dashboard/index.blade.php",
    "resources/views/user/analytics/index.blade.php",
    "resources/views/admin/dashboard/index.blade.php",
    "resources/views/admin/analytics/index.blade.php",
    "resources/views/admin/financial/index.blade.php",
    "resources/views/admin/health/index.blade.php",
    "resources/views/components/user/quick-access-drawer.blade.php",
    "resources/views/components/user/quick-access-modal.blade.php"
  ],
  "commands": [],
  "permissions": ["analytics.view"],
  "middleware": [],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/admin-overview.js",
    "resources/js/charts/admin-financial.js",
    "resources/js/charts/admin-analytics-index.js",
    "resources/js/charts/user-analytics-index.js",
    "resources/js/charts/user-dashboard-index.js",
    "resources/js/charts/analytics-index.js",
    "resources/js/charts/user-overview.js",
    "resources/js/theme-colors.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/growth/analytics.html",
    "Documentation/pages/admin-panel/dashboard.html",
    "Documentation/pages/admin-panel/system-health.html",
    "Documentation/pages/getting-started/dashboard.html"
  ],
  "feature_map": {
    "TW-DASH-001": ["GET home", "GET dashboard"],
    "TW-DASH-002": [],
    "TW-DASH-003": ["GET dashboard"],
    "TW-DASH-004": ["GET dashboard"],
    "TW-DASH-005": ["GET dashboard"],
    "TW-DASH-006": ["GET dashboard"],
    "TW-DASH-007": ["GET dashboard"],
    "TW-DASH-008": ["GET dashboard"],
    "TW-DASH-009": ["POST quick-access", "GET dashboard"],
    "TW-DASH-010": [],
    "TW-DASH-011": ["GET dashboard"],
    "TW-DASH-012": ["GET dashboard"],
    "TW-DASH-013": ["GET dashboard"],
    "TW-DASH-014": ["GET dashboard"],
    "TW-DASH-015": ["GET dashboard"],
    "TW-DASH-016": ["GET dashboard"],
    "TW-DASH-017": ["GET dashboard"],
    "TW-DASH-018": ["GET dashboard"],
    "TW-DASH-019": ["GET dashboard"],
    "TW-DASH-020": ["GET dashboard"],
    "TW-DASH-021": ["GET dashboard"],
    "TW-DASH-022": ["GET analytics"],
    "TW-DASH-023": ["GET analytics"],
    "TW-DASH-024": ["GET analytics"],
    "TW-DASH-025": ["GET analytics"],
    "TW-DASH-026": ["GET analytics"],
    "TW-DASH-027": ["GET analytics"],
    "TW-DASH-028": ["GET analytics"],
    "TW-DASH-029": ["GET analytics"],
    "TW-DASH-030": ["GET analytics"],
    "TW-DASH-031": ["GET analytics"],
    "TW-DASH-032": ["GET analytics/export"],
    "TW-DASH-033": [],
    "TW-DASH-034": ["GET admin"],
    "TW-DASH-035": ["GET admin"],
    "TW-DASH-036": ["GET admin"],
    "TW-DASH-037": ["GET admin"],
    "TW-DASH-038": ["GET admin"],
    "TW-DASH-039": ["GET admin"],
    "TW-DASH-040": ["GET admin"],
    "TW-DASH-041": ["GET admin/analytics"],
    "TW-DASH-042": ["GET admin/analytics"],
    "TW-DASH-043": ["GET admin/analytics"],
    "TW-DASH-044": ["GET admin/analytics"],
    "TW-DASH-045": ["GET admin/financial"],
    "TW-DASH-046": ["GET admin/financial"],
    "TW-DASH-047": ["GET admin/financial"],
    "TW-DASH-048": ["GET admin/health"],
    "TW-DASH-049": ["GET admin/health"],
    "TW-DASH-050": ["GET admin/health"],
    "TW-DASH-051": ["POST admin/health/clear-queue"],
    "TW-DASH-052": [],
    "TW-DASH-053": [],
    "TW-DASH-054": []
  }
}
```
